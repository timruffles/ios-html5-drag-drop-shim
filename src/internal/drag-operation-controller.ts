import { Config } from "../index";
import {
    CLASS_DRAG_IMAGE, CLASS_DRAG_OPERATION_ICON, CLASS_PREFIX, DROP_EFFECT, DROP_EFFECTS
} from "./constants";
import {
    addDocumentListener, applyDragImageSnapback, extractTransformStyles, isDOMElement,
    isTouchIdentifierContainedInTouchEvent, Point, removeDocumentListener, translateElementToPoint,
    updateCentroidCoordinatesOfTouchesIn
} from "./dom-utils";
import { DataTransfer, DragDataStore, DragDataStoreMode } from "./drag-data-store";
import { determineDragOperation, determineDropEffect, dispatchDragEvent } from "./drag-utils";

/**
 * For tracking the different states of a drag operation.
 */
export const enum DragOperationState {
    // initial state of a controller, if no movement is detected the operation ends with this state
    POTENTIAL,
    // after movement is detected the drag operation starts and keeps this state until it ends
    STARTED,
    // when the drag operation ended normally
    ENDED,
    // when the drag operation ended with a cancelled input event
    CANCELLED
}

/**
 * Aims to implement the HTML5 d'n'd spec (https://html.spec.whatwg.org/multipage/interaction.html#dnd) as close as it can get.
 * Note that all props that are private should start with an underscore to enable better minification.
 *
 * TODO remove lengthy spec comments in favor of short references to the spec
 */
export class DragOperationController {

    private _dragOperationState:DragOperationState = DragOperationState.POTENTIAL;

    private _dragImage:HTMLElement;
    private _dragImageTransforms:string[];
    private _dragImagePageCoordinates:Point; // the current page coordinates of the dragImage
    private _dragImageOffset:Point; // offset of the drag image relative to the coordinates

    private _currentHotspotCoordinates:Point;    // the point relative to viewport for determining the immediate user selection

    private _immediateUserSelection:HTMLElement = null;  // the element the user currently hovers while dragging
    private _currentDropTarget:HTMLElement = null;   // the element that was selected as a valid drop target by the d'n'd operation

    private _dragDataStore:DragDataStore;
    private _dataTransfer:DataTransfer;

    private _currentDragOperation:string;    // the current drag operation set according to the d'n'd processing model

    private _initialTouch:Touch;  // the identifier for the touch that initiated the drag operation
    private _touchMoveHandler:EventListener;
    private _touchEndOrCancelHandler:EventListener;
    private _lastTouchEvent:TouchEvent;

    private _iterationLock:boolean;
    private _iterationIntervalId:number;

    constructor( private _initialEvent:TouchEvent,
                 private _config:Config,
                 private _sourceNode:HTMLElement,
                 private _dragOperationEndedCb:( config:Config, event:TouchEvent, state:DragOperationState ) => void ) {

        console.log( "dnd-poly: setting up potential drag operation.." );

        this._lastTouchEvent = _initialEvent;
        this._initialTouch = _initialEvent.changedTouches[ 0 ];

        // create bound event listeners
        this._touchMoveHandler = this._onTouchMove.bind( this );
        this._touchEndOrCancelHandler = this._onTouchEndOrCancel.bind( this );
        addDocumentListener( "touchmove", this._touchMoveHandler, false );
        addDocumentListener( "touchend", this._touchEndOrCancelHandler, false );
        addDocumentListener( "touchcancel", this._touchEndOrCancelHandler, false );

        // the only thing we do is setup the touch listeners. if drag will really start is decided in touch move handler.

        //<spec>

        // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
        // 3. Establish which DOM node is the source node, as follows:
        // If it is a selection that is being dragged, then the source node is the text node that the user started the drag on (typically the text node
        // that the user originally clicked). If the user did not specify a particular node, for example if the user just told the user agent to begin
        // a drag of "the selection", then the source node is the first text node containing a part of the selection.  Otherwise, if it is an element
        // that is being dragged, then the source node is the element that is being dragged.  Otherwise, the source node is part of another document or
        // application. When this specification requires that an event be dispatched at the source node in this case, the user agent must instead
        // follow the platform-specific conventions relevant to that situation.

        // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
        // 4. Determine the list of dragged nodes, as follows:

        //    If it is a selection that is being dragged, then the list of dragged nodes contains, in tree order, every node that is partially or
        // completely included in the selection (including all their ancestors).

        //    Otherwise, the list of dragged nodes contains only the source node, if any.

        // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
        // 5. If it is a selection that is being dragged, then add an item to the drag data store item list, with its properties set as follows:

        //The drag data item type string
        //"text/plain"
        //The drag data item kind
        //Plain Unicode string
        //The actual data
        //The text of the selection
        //Otherwise, if any files are being dragged, then add one item per file to the drag data store item list, with their properties set as follows:
        //
        //The drag data item type string
        //The MIME type of the file, if known, or "application/octet-stream" otherwise.
        //    The drag data item kind
        //File
        //The actual data
        //The file's contents and name.
        //Dragging files can currently only happen from outside a browsing context, for example from a file system manager application.
        //
        //    If the drag initiated outside of the application, the user agent must add items to the drag data store item list as appropriate for the data
        // being dragged, honoring platform conventions where appropriate; however, if the platform conventions do not use MIME types to label dragged
        // data, the user agent must make a best-effort attempt to map the types to MIME types, and, in any case, all the drag data item type strings must
        // be converted to ASCII lowercase.  Perform drag-and-drop initialization steps defined in any other applicable specifications.

        //</spec>
    }

    //<editor-fold desc="setup/teardown">

    /**
     * Setup dragImage, input listeners and the drag
     * and drop process model iteration interval.
     */
    private _setup():boolean {
        console.log( "dnd-poly: starting drag and drop operation" );

        this._dragOperationState = DragOperationState.STARTED;

        this._currentDragOperation = DROP_EFFECTS[ DROP_EFFECT.NONE ];

        this._dragDataStore = {
            data: {},
            effectAllowed: undefined,
            mode: DragDataStoreMode.PROTECTED,
            types: [],
        };

        this._currentHotspotCoordinates = {
            x: null,
            y: null
        };

        this._dragImagePageCoordinates = {
            x: null,
            y: null
        };

        let dragImageSrc:HTMLElement = this._sourceNode;

        this._dataTransfer = new DataTransfer( this._dragDataStore, ( element:HTMLElement, x:number, y:number ) => {

            dragImageSrc = element;

            if( typeof x === "number" || typeof y === "number" ) {
                this._dragImageOffset = {
                    x: x || 0,
                    y: y || 0
                };
            }
        } );

        // 9. Fire a DND event named dragstart at the source node.
        this._dragDataStore.mode = DragDataStoreMode.READWRITE;
        this._dataTransfer.dropEffect = DROP_EFFECTS[ DROP_EFFECT.NONE ];
        if( dispatchDragEvent( "dragstart", this._sourceNode, this._lastTouchEvent, this._dragDataStore, this._dataTransfer ) ) {
            console.log( "dnd-poly: dragstart cancelled" );
            // dragstart has been prevented -> cancel d'n'd
            this._dragOperationState = DragOperationState.CANCELLED;
            this._cleanup();
            return false;
        }

        updateCentroidCoordinatesOfTouchesIn( "page", this._lastTouchEvent, this._dragImagePageCoordinates );
        const dragImage = this._config.dragImageSetup( dragImageSrc );
        this._dragImageTransforms = extractTransformStyles( dragImage );
        // set layout styles for freely moving it around
        dragImage.style.position = "absolute";
        dragImage.style.left = "0px";
        dragImage.style.top = "0px";
        // on top of all
        dragImage.style.zIndex = "999999";

        // add polyfill class for default styling
        dragImage.classList.add( CLASS_DRAG_IMAGE );
        dragImage.classList.add( CLASS_DRAG_OPERATION_ICON );
        this._dragImage = dragImage;

        if( !this._dragImageOffset ) {

            // apply specific offset
            if( this._config.dragImageOffset ) {

                this._dragImageOffset = {
                    x: this._config.dragImageOffset.x,
                    y: this._config.dragImageOffset.y
                };
            }
            // center drag image on touch coordinates
            else if( this._config.dragImageCenterOnTouch ) {

                const cs = getComputedStyle( dragImageSrc );
                this._dragImageOffset = {
                    x: 0 - parseInt( cs.marginLeft, 10 ),
                    y: 0 - parseInt( cs.marginTop, 10 )
                };
            }
            // by default initialize drag image offset the same as desktop
            else {

                const targetRect = dragImageSrc.getBoundingClientRect();
                const cs = getComputedStyle( dragImageSrc );
                this._dragImageOffset = {
                    x: targetRect.left - this._initialTouch.clientX - parseInt( cs.marginLeft, 10 ) + targetRect.width / 2,
                    y: targetRect.top - this._initialTouch.clientY - parseInt( cs.marginTop, 10 ) + targetRect.height / 2
                };
            }
        }

        translateElementToPoint( this._dragImage, this._dragImagePageCoordinates, this._dragImageTransforms, this._dragImageOffset, this._config.dragImageCenterOnTouch );
        document.body.appendChild( this._dragImage );

        // 10. Initiate the drag-and-drop operation in a manner consistent with platform conventions, and as described below.
        this._iterationIntervalId = window.setInterval( () => {

            // If the user agent is still performing the previous iteration of the sequence (if any) when the next iteration becomes due,
            // abort these steps for this iteration (effectively "skipping missed frames" of the drag-and-drop operation).
            if( this._iterationLock ) {
                console.log( "dnd-poly: iteration skipped because previous iteration hast not yet finished." );
                return;
            }
            this._iterationLock = true;

            this._dragAndDropProcessModelIteration();

            this._iterationLock = false;
        }, this._config.iterationInterval );

        return true;
    }

    public _cleanup() {

        console.log( "dnd-poly: cleanup" );

        if( this._iterationIntervalId ) {
            clearInterval( this._iterationIntervalId );
            this._iterationIntervalId = null;
        }

        removeDocumentListener( "touchmove", this._touchMoveHandler );
        removeDocumentListener( "touchend", this._touchEndOrCancelHandler );
        removeDocumentListener( "touchcancel", this._touchEndOrCancelHandler );

        if( this._dragImage ) {
            this._dragImage.parentNode.removeChild( this._dragImage );
            this._dragImage = null;
        }

        this._dragOperationEndedCb( this._config, this._lastTouchEvent, this._dragOperationState );
    }

    //</editor-fold>

    //<editor-fold desc="touch handlers">

    private _onTouchMove( event:TouchEvent ) {

        // filter unrelated touches
        if( isTouchIdentifierContainedInTouchEvent( event, this._initialTouch.identifier ) === false ) {
            return;
        }

        // update the reference to the last received touch event
        this._lastTouchEvent = event;

        // drag operation did not start yet but on movement it should start
        if( this._dragOperationState === DragOperationState.POTENTIAL ) {

            let startDrag:boolean;

            // is a lifecycle hook present?
            if( this._config.dragStartConditionOverride ) {

                try {
                    startDrag = this._config.dragStartConditionOverride( event );
                }
                catch( e ) {
                    console.error( "dnd-poly: error in dragStartConditionOverride hook: " + e );
                    startDrag = false;
                }
            }
            else {

                // by default only allow a single moving finger to initiate a drag operation
                startDrag = (event.touches.length === 1);
            }

            if( !startDrag ) {

                this._cleanup();
                return;
            }

            // setup will return true when drag operation starts
            if( this._setup() === true ) {

                // prevent scrolling when drag operation starts
                this._initialEvent.preventDefault();
                event.preventDefault();
            }

            return;
        }

        console.log( "dnd-poly: moving draggable.." );

        // we emulate d'n'd so we dont want any defaults to apply
        event.preventDefault();

        // populate shared coordinates from touch event
        updateCentroidCoordinatesOfTouchesIn( "client", event, this._currentHotspotCoordinates );
        updateCentroidCoordinatesOfTouchesIn( "page", event, this._dragImagePageCoordinates );

        if( this._config.dragImageTranslateOverride ) {

            try {

                let handledDragImageTranslate = false;

                this._config.dragImageTranslateOverride(
                    event,
                    {
                        x: this._currentHotspotCoordinates.x,
                        y: this._currentHotspotCoordinates.y
                    },
                    this._immediateUserSelection,
                    ( offsetX:number, offsetY:number ) => {

                        // preventing translation of drag image when there was a drag operation cleanup meanwhile
                        if( !this._dragImage ) {
                            return;
                        }

                        handledDragImageTranslate = true;

                        this._currentHotspotCoordinates.x += offsetX;
                        this._currentHotspotCoordinates.y += offsetY;
                        this._dragImagePageCoordinates.x += offsetX;
                        this._dragImagePageCoordinates.y += offsetY;

                        translateElementToPoint(
                            this._dragImage,
                            this._dragImagePageCoordinates,
                            this._dragImageTransforms,
                            this._dragImageOffset,
                            this._config.dragImageCenterOnTouch
                        );
                    }
                );

                if( handledDragImageTranslate ) {
                    return;
                }
            }
            catch( e ) {
                console.log( "dnd-poly: error in dragImageTranslateOverride hook: " + e );
            }
        }

        translateElementToPoint( this._dragImage, this._dragImagePageCoordinates, this._dragImageTransforms, this._dragImageOffset, this._config.dragImageCenterOnTouch );
    }

    private _onTouchEndOrCancel( event:TouchEvent ) {

        // filter unrelated touches
        if( isTouchIdentifierContainedInTouchEvent( event, this._initialTouch.identifier ) === false ) {
            return;
        }

        // let the dragImageTranslateOverride know that its over
        if( this._config.dragImageTranslateOverride ) {
            try {
                /* tslint:disable */
                this._config.dragImageTranslateOverride( undefined, undefined, undefined, function() {
                } );
            }
            catch( e ) {
                console.log( "dnd-poly: error in dragImageTranslateOverride hook: " + e );
            }
        }

        // drag operation did not even start
        if( this._dragOperationState === DragOperationState.POTENTIAL ) {
            this._cleanup();
            return;
        }

        // we emulate d'n'd so we dont want any defaults to apply
        event.preventDefault();

        this._dragOperationState = (event.type === "touchcancel") ? DragOperationState.CANCELLED : DragOperationState.ENDED;
    }

    //</editor-fold>

    //<editor-fold desc="dnd spec logic">

    /**
     * according to https://html.spec.whatwg.org/multipage/interaction.html#drag-and-drop-processing-model
     */
    private _dragAndDropProcessModelIteration():void {

        // if( DEBUG ) {
        //     var debug_class = CLASS_PREFIX + "debug",
        //         debug_class_user_selection = CLASS_PREFIX + "immediate-user-selection",
        //         debug_class_drop_target = CLASS_PREFIX + "current-drop-target";
        // }

        const previousDragOperation = this._currentDragOperation;

        // Fire a DND event named drag event at the source node.
        this._dragDataStore.mode = DragDataStoreMode.PROTECTED;
        this._dataTransfer.dropEffect = DROP_EFFECTS[ DROP_EFFECT.NONE ];
        const dragCancelled = dispatchDragEvent( "drag", this._sourceNode, this._lastTouchEvent, this._dragDataStore, this._dataTransfer );
        if( dragCancelled ) {
            console.log( "dnd-poly: drag event cancelled." );
            // If this event is canceled, the user agent must set the current drag operation to "none" (no drag operation).
            this._currentDragOperation = DROP_EFFECTS[ DROP_EFFECT.NONE ];
        }

        // Otherwise, if the user ended the drag-and-drop operation (e.g. by releasing the mouse button in a mouse-driven drag-and-drop interface),
        // or if the drag event was canceled, then this will be the last iteration.
        if( dragCancelled || this._dragOperationState === DragOperationState.ENDED || this._dragOperationState === DragOperationState.CANCELLED ) {

            const dragFailed = this._dragOperationEnded( this._dragOperationState );

            // if drag failed transition snap back
            if( dragFailed ) {

                applyDragImageSnapback( this._sourceNode, this._dragImage, this._dragImageTransforms, () => {
                    this._finishDragOperation();
                } );
                return;
            }

            // Otherwise immediately
            // Fire a DND event named dragend at the source node.
            this._finishDragOperation();
            return;
        }

        // If the drag event was not canceled and the user has not ended the drag-and-drop operation,
        // check the state of the drag-and-drop operation, as follows:
        const newUserSelection:HTMLElement = <HTMLElement>this._config.elementFromPoint( this._currentHotspotCoordinates.x, this._currentHotspotCoordinates.y );

        console.log( "dnd-poly: new immediate user selection is: " + newUserSelection );

        const previousTargetElement = this._currentDropTarget;

        // If the user is indicating a different immediate user selection than during the last iteration (or if this is the first iteration),
        // and if this immediate user selection is not the same as the current target element,
        // then fire a DND event named dragexit at the current target element,
        // and then update the current target element as follows:
        if( newUserSelection !== this._immediateUserSelection && newUserSelection !== this._currentDropTarget ) {

            // if( DEBUG ) {
            //
            //     if( this._immediateUserSelection ) {
            //         this._immediateUserSelection.classList.remove( debug_class_user_selection );
            //     }
            //
            //     if( newUserSelection ) {
            //         newUserSelection.classList.add( debug_class );
            //         newUserSelection.classList.add( debug_class_user_selection );
            //     }
            // }

            this._immediateUserSelection = newUserSelection;

            if( this._currentDropTarget !== null ) {
                this._dragDataStore.mode = DragDataStoreMode.PROTECTED;
                this._dataTransfer.dropEffect = DROP_EFFECTS[ DROP_EFFECT.NONE ];
                dispatchDragEvent( "dragexit", this._currentDropTarget, this._lastTouchEvent, this._dragDataStore, this._dataTransfer, false );
            }

            // If the new immediate user selection is null
            if( this._immediateUserSelection === null ) {
                //Set the current target element to null also.
                this._currentDropTarget = this._immediateUserSelection;

                console.log( "dnd-poly: current drop target changed to null" );
            }
            // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
            // If the new immediate user selection is in a non-DOM document or application
            // else if() {
            //      Set the current target element to the immediate user selection.
            //      this.currentDropTarget = this.immediateUserSelection;
            //      return;
            // }
            // Otherwise
            else {
                // Fire a DND event named dragenter at the immediate user selection.
                //the polyfill cannot determine if a handler even exists as browsers do to silently
                // allow drop when no listener existed, so this event MUST be handled by the client
                this._dragDataStore.mode = DragDataStoreMode.PROTECTED;
                this._dataTransfer.dropEffect = determineDropEffect( this._dragDataStore.effectAllowed, this._sourceNode );
                if( dispatchDragEvent( "dragenter", this._immediateUserSelection, this._lastTouchEvent, this._dragDataStore, this._dataTransfer ) ) {
                    console.log( "dnd-poly: dragenter default prevented" );
                    // If the event is canceled, then set the current target element to the immediate user selection.
                    this._currentDropTarget = this._immediateUserSelection;
                    this._currentDragOperation = determineDragOperation( this._dataTransfer.effectAllowed, this._dataTransfer.dropEffect );
                }
                // Otherwise, run the appropriate step from the following list:
                else {

                    // NO DROPZONE SUPPORT SINCE NATIVE IMPLEMENTATIONS IN BROWSERS ALSO DO NOT
                    //console.log( "dnd-poly: dragenter not prevented, searching for dropzone.." );
                    //var newTarget = DragOperationController.FindDropzoneElement( this.immediateUserSelection );

                    // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
                    // If the current target element is a text field (e.g. textarea, or an input element whose type attribute is in the Text state) or an
                    // editable element, and the drag data store item list has an item with the drag data item type string "text/plain" and the drag data
                    // item kind Plain Unicode string
                    //if( ElementIsTextDropzone( this.immediateUserSelection, this.dragDataStore ) ) {
                    //Set the current target element to the immediate user selection anyway.
                    //this.currentDropTarget = this.immediateUserSelection;
                    //}
                    //else
                    // If the current target element is an element with a dropzone attribute that matches the drag data store
                    //if( newTarget === this.immediateUserSelection &&
                    //    DragOperationController.GetOperationForMatchingDropzone( this.immediateUserSelection, this.dragDataStore ) !== "none" ) {
                    // Set the current target element to the immediate user selection anyway.
                    //    this.currentDropTarget = this.immediateUserSelection;
                    //}
                    // If the immediate user selection is an element that itself has an ancestor element
                    // with a dropzone attribute that matches the drag data store
                    // NO DROPZONE SUPPORT SINCE NATIVE IMPLEMENTATIONS IN BROWSERS ALSO DO NOT
                    //else if( newTarget !== null && DragOperationController.GetOperationForMatchingDropzone( newTarget, this.dragDataStore ) ) {

                    // If the immediate user selection is new target, then leave the current target element unchanged.

                    // Otherwise, fire a DND event named dragenter at new target, with the current target element
                    // as the specific related target. Then, set the current target element to new target,
                    // regardless of whether that event was canceled or not.
                    //this.dragenter( newTarget, this.currentDropTarget );
                    //this.currentDropTarget = newTarget;
                    //}
                    // If the current target element is not the body element
                    //else
                    if( this._immediateUserSelection !== document.body ) {
                        // Fire a DND event named dragenter at the body element, and set the current target element to the body element, regardless of
                        // whether that event was canceled or not.
                        // Note: If the body element is null, then the event will be fired at the Document object (as
                        // required by the definition of the body element), but the current target element would be set to null, not the Document object.

                        // We do not listen to what the spec says here because this results in doubled events on the body/document because if the first one
                        // was not cancelled it will have bubbled up to the body already ;)
                        //  this.dragenter( window.document.body );
                        this._currentDropTarget = document.body;
                    }
                    // Otherwise
                    //else {
                    // leave the current drop target unchanged
                    //}
                }
            }
        }

        // If the previous step caused the current target element to change,
        // and if the previous target element was not null or a part of a non-DOM document,
        // then fire a DND event named dragleave at the previous target element.
        if( previousTargetElement !== this._currentDropTarget && (isDOMElement( previousTargetElement )) ) {

            // if( DEBUG ) {
            //     previousTargetElement.classList.remove( debug_class_drop_target );
            // }

            console.log( "dnd-poly: current drop target changed." );

            this._dragDataStore.mode = DragDataStoreMode.PROTECTED;
            this._dataTransfer.dropEffect = DROP_EFFECTS[ DROP_EFFECT.NONE ];
            dispatchDragEvent( "dragleave", previousTargetElement, this._lastTouchEvent, this._dragDataStore, this._dataTransfer, false, this._currentDropTarget );
        }

        // If the current target element is a DOM element, then fire a DND event named dragover at this current target element.
        if( isDOMElement( this._currentDropTarget ) ) {

            // if( DEBUG ) {
            //     this._currentDropTarget.classList.add( debug_class );
            //     this._currentDropTarget.classList.add( debug_class_drop_target );
            // }

            // If the dragover event is not canceled, run the appropriate step from the following list:
            this._dragDataStore.mode = DragDataStoreMode.PROTECTED;
            this._dataTransfer.dropEffect = determineDropEffect( this._dragDataStore.effectAllowed, this._sourceNode );
            if( dispatchDragEvent( "dragover", this._currentDropTarget, this._lastTouchEvent, this._dragDataStore, this._dataTransfer ) === false ) {

                console.log( "dnd-poly: dragover not prevented on possible drop-target." );
                // NO DROPZONE SUPPORT SINCE NATIVE IMPLEMENTATIONS IN BROWSERS ALSO DO NOT

                // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
                // If the current target element is a text field (e.g. textarea, or an input element whose type attribute is in the Text state) or
                // an editable element, and the drag data store item list has an item with the drag data item type string "text/plain" and the drag
                // data item kind Plain Unicode string
                //if( ElementIsTextDropzone( this.currentDropTarget, this.dragDataStore ) ) {
                // Set the current drag operation to either "copy" or "move", as appropriate given the platform conventions.
                //this.currentDragOperation = "copy"; //or move. spec says its platform specific behaviour.
                //}
                //else {
                // If the current target element is an element with a dropzone attribute that matches the drag data store
                //this.currentDragOperation = DragOperationController.GetOperationForMatchingDropzone( this.currentDropTarget, this.dragDataStore );
                //}
                // when dragover is not prevented and no dropzones are there, no drag operation
                this._currentDragOperation = DROP_EFFECTS[ DROP_EFFECT.NONE ];
            }
            // Otherwise (if the dragover event is canceled), set the current drag operation based on the values of the effectAllowed and
            // dropEffect attributes of the DragEvent object's dataTransfer object as they stood after the event dispatch finished
            else {

                console.log( "dnd-poly: dragover prevented." );

                this._currentDragOperation = determineDragOperation( this._dataTransfer.effectAllowed, this._dataTransfer.dropEffect );
            }
        }

        console.log( "dnd-poly: d'n'd iteration ended. current drag operation: " + this._currentDragOperation );

        // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
        // Otherwise, if the current target element is not a DOM element, use platform-specific mechanisms to determine what drag operation is
        // being performed (none, copy, link, or move), and set the current drag operation accordingly.

        //Update the drag feedback (e.g. the mouse cursor) to match the current drag operation, as follows:
        // ---------------------------------------------------------------------------------------------------------
        // Drag operation   |	Feedback
        // "copy"	        |  Data will be copied if dropped here.
        // "link"	        |  Data will be linked if dropped here.
        // "move"	        |  Data will be moved if dropped here.
        // "none"	        |  No operation allowed, dropping here will cancel the drag-and-drop operation.
        // ---------------------------------------------------------------------------------------------------------

        if( previousDragOperation !== this._currentDragOperation ) {
            this._dragImage.classList.remove( CLASS_PREFIX + previousDragOperation );
        }

        const currentDragOperationClass = CLASS_PREFIX + this._currentDragOperation;

        this._dragImage.classList.add( currentDragOperationClass );
    }

    /**
     * according to https://html.spec.whatwg.org/multipage/interaction.html#drag-and-drop-processing-model
     */
    private _dragOperationEnded( state:DragOperationState ):boolean {

        console.log( "dnd-poly: drag operation end detected with " + this._currentDragOperation );

        // if( DEBUG ) {
        //
        //     var debug_class_user_selection = CLASS_PREFIX + "immediate-user-selection",
        //         debug_class_drop_target = CLASS_PREFIX + "current-drop-target";
        //
        //     if( this._currentDropTarget ) {
        //         this._currentDropTarget.classList.remove( debug_class_drop_target );
        //
        //     }
        //     if( this._immediateUserSelection ) {
        //         this._immediateUserSelection.classList.remove( debug_class_user_selection );
        //     }
        // }

        //var dropped:boolean = undefined;

        // Run the following steps, then stop the drag-and-drop operation:

        // If the current drag operation is "none" (no drag operation), or,
        // if the user ended the drag-and-drop operation by canceling it (e.g. by hitting the Escape key), or
        // if the current target element is null, then the drag operation failed.
        const dragFailed = (this._currentDragOperation === DROP_EFFECTS[ DROP_EFFECT.NONE ]
            || this._currentDropTarget === null
            || state === DragOperationState.CANCELLED);
        if( dragFailed ) {

            // Run these substeps:

            // Let dropped be false.
            //dropped = false;

            // If the current target element is a DOM element, fire a DND event named dragleave at it;
            if( isDOMElement( this._currentDropTarget ) ) {
                this._dragDataStore.mode = DragDataStoreMode.PROTECTED;
                this._dataTransfer.dropEffect = DROP_EFFECTS[ DROP_EFFECT.NONE ];
                dispatchDragEvent( "dragleave", this._currentDropTarget, this._lastTouchEvent, this._dragDataStore, this._dataTransfer, false );
            }

            // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
            // otherwise, if it is not null, use platform-specific conventions for drag cancellation.
            //else if( this.currentDropTarget !== null ) {
            //}
        }
        // Otherwise, the drag operation was as success; run these substeps:
        else {

            // Let dropped be true.
            //dropped = true;

            // If the current target element is a DOM element, fire a DND event named drop at it;
            if( isDOMElement( this._currentDropTarget ) ) {

                // If the event is canceled, set the current drag operation to the value of the dropEffect attribute of the
                // DragEvent object's dataTransfer object as it stood after the event dispatch finished.

                this._dragDataStore.mode = DragDataStoreMode.READONLY;
                this._dataTransfer.dropEffect = this._currentDragOperation;
                if( dispatchDragEvent( "drop", this._currentDropTarget, this._lastTouchEvent, this._dragDataStore, this._dataTransfer ) ===
                    true ) {

                    this._currentDragOperation = this._dataTransfer.dropEffect;
                }
                // Otherwise, the event is not canceled; perform the event's default action, which depends on the exact target as follows:
                else {

                    // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
                    // If the current target element is a text field (e.g. textarea, or an input element whose type attribute is in the Text state)
                    // or an editable element,
                    // and the drag data store item list has an item with the drag data item type string "text/plain"
                    // and the drag data item kind Plain Unicode string
                    //if( ElementIsTextDropzone( this.currentDropTarget, this.dragDataStore ) ) {
                    // Insert the actual data of the first item in the drag data store item list to have a drag data item type string of
                    // "text/plain" and a drag data item kind that is Plain Unicode string into the text field or editable element in a manner
                    // consistent with platform-specific conventions (e.g. inserting it at the current mouse cursor position, or inserting it at
                    // the end of the field).
                    //}
                    // Otherwise
                    //else {
                    // Reset the current drag operation to "none".
                    this._currentDragOperation = DROP_EFFECTS[ DROP_EFFECT.NONE ];
                    //}
                }
            }
            // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
            // otherwise, use platform-specific conventions for indicating a drop.
            //else {
            //}
        }

        return dragFailed;

        // THIS IS SKIPPED SINCE SUPPORT IS ONLY AVAILABLE FOR DOM ELEMENTS
        //if( this.dragend( this.sourceNode ) ) {
        //    return;
        //}

        // Run the appropriate steps from the following list as the default action of the dragend event:

        //if( !dropped ) {
        //    return;
        //}
        // dropped is true

        //if( this.currentDragOperation !== "move" ) {
        //    return;
        //}
        //// drag operation is move
        //
        //if( ElementIsTextDropzone( this.currentDropTarget ) === false ) {
        //    return;
        //}
        //// element is textfield
        //
        //// and the source of the drag-and-drop operation is a selection in the DOM
        //if( this.sourceNode.nodeType === 1 ) {
        //    // The user agent should delete the range representing the dragged selection from the DOM.
        //}
        //// and the source of the drag-and-drop operation is a selection in a text field
        //else if( this.sourceNode.nodeType === 3 ) {
        //    // The user agent should delete the dragged selection from the relevant text field.
        //}
        //// Otherwise, The event has no default action.
    }

    // dispatch dragend event and cleanup drag operation
    private _finishDragOperation():void {
        console.log( "dnd-poly: dragimage snap back transition ended" );

        // Fire a DND event named dragend at the source node.
        this._dragDataStore.mode = DragDataStoreMode.PROTECTED;
        this._dataTransfer.dropEffect = this._currentDragOperation;
        dispatchDragEvent( "dragend", this._sourceNode, this._lastTouchEvent, this._dragDataStore, this._dataTransfer, false );

        // drag operation over and out
        this._dragOperationState = DragOperationState.ENDED;
        this._cleanup();
    }

    //</editor-fold>
}
