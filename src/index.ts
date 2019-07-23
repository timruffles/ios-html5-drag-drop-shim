import { addDocumentListener, createDragImage, onEvt, Point } from "./internal/dom-utils";
import { DragOperationController, DragOperationState } from "./internal/drag-operation-controller";
import { tryFindDraggableTarget } from "./internal/drag-utils";
import { detectFeatures } from "./internal/feature-detection";
import { EVENT_DRAG_DRAGSTART_PENDING, EVENT_DRAG_DRAGSTART_CANCEL } from "./internal/constants";

// default config
const config:Config = {
    iterationInterval: 150,
    tryFindDraggableTarget: tryFindDraggableTarget,
    dragImageSetup: createDragImage,
    elementFromPoint: function( x, y ) { return document.elementFromPoint( x, y ); }
};

// reference to the currently active drag operation
let activeDragOperation:DragOperationController;

/**
 * event handler for initial touch events that possibly start a drag and drop operation.
 */
function onTouchstart( e:TouchEvent ) {

    console.log( "dnd-poly: global touchstart" );

    // From the moment that the user agent is to initiate the drag-and-drop operation,
    // until the end of the drag-and-drop operation, device input events (e.g. mouse and keyboard events) must be suppressed.

    // only allow one drag operation at a time
    if( activeDragOperation ) {
        console.log( "dnd-poly: drag operation already active" );
        // try avoid infinite loop on iOS if something happened with draggable dom object (disappeared or changed during drag)
        activeDragOperation.cleanup();
        return;
    }

    let dragTarget = config.tryFindDraggableTarget( e );

    // If there is no such element, then nothing is being dragged; abort these
    // steps, the drag-and-drop operation is never started.
    if( !dragTarget ) {
        console.log("dnd-poly: no draggable at touchstart coordinates");
        return;
    }

    try {
        activeDragOperation = new DragOperationController( e, config, dragTarget as HTMLElement, dragOperationEnded );
    }
    catch( err ) {
        dragOperationEnded( config, e, DragOperationState.CANCELLED );
        // rethrow exception after cleanup
        throw err;
    }
}

function onDelayTouchstart( evt:TouchEvent ) {

    console.log("dnd-poly: setup delayed dragstart..");

    const el = evt.target;

    const heldItem = () => {

        console.log("dnd-poly: starting delayed drag..");

        end.off();
        cancel.off();
        move.off();
        scroll.off();
        onTouchstart( evt );
    };

    const onReleasedItem = (event:Event) => {

        console.log("dnd-poly: aborting delayed drag because of " + event.type);

        end.off();
        cancel.off();
        move.off();
        scroll.off();

        if (el) {
            el.dispatchEvent(new CustomEvent(EVENT_DRAG_DRAGSTART_CANCEL, { bubbles: true, cancelable: true }));
        }

        clearTimeout( timer );
    };

    if (el) {
        el.dispatchEvent(new CustomEvent(EVENT_DRAG_DRAGSTART_PENDING, { bubbles: true, cancelable: true }));
    }

    const timer = window.setTimeout( heldItem, config.holdToDrag );

    const end = onEvt( el, "touchend", onReleasedItem );
    const cancel = onEvt( el, "touchcancel", onReleasedItem );
    const move = onEvt( el, "touchmove", onReleasedItem );
    // scroll events don't bubble, only way to listen to scroll events
    // that are about to happen in nested scrollables is by listening in capture phase
    const scroll = onEvt( window, "scroll", onReleasedItem, true );
}

/**
 * Implements callback invoked when a drag operation has ended or crashed.
 */
function dragOperationEnded( _config:Config, event:TouchEvent, state:DragOperationState ) {

    // we need to make the default action happen only when no drag operation took place
    if( state === DragOperationState.POTENTIAL ) {

        console.log( "dnd-poly: Drag never started. Last event was " + event.type );

        // when lifecycle hook is present
        if( _config.defaultActionOverride ) {

            try {

                _config.defaultActionOverride( event );

                if( event.defaultPrevented ) {

                    console.log( "dnd-poly: defaultActionOverride has taken care of triggering the default action. preventing default on original event" );
                }

            }
            catch( e ) {

                console.log( "dnd-poly: error in defaultActionOverride: " + e );
            }
        }
    }

    // reset drag operation container
    activeDragOperation = null;
}

//<editor-fold desc="public api">

export { Point } from "./internal/dom-utils";

// function signature for the dragImageTranslateOverride hook
export type DragImageTranslateOverrideFn = ( // corresponding touchmove event
    event:TouchEvent,
    // the processed touch event viewport coordinates
    hoverCoordinates:Point,
    // the element under the calculated touch coordinates
    hoveredElement:HTMLElement,
    // callback for updating the drag image offset
    translateDragImageFn:( offsetX:number, offsetY:number ) => void ) => void;

export interface Config {

    // flag to force the polyfill being applied and not rely on internal feature detection
    forceApply?:boolean;

    // useful for when you want the default drag image but still want to apply
    // some static offset from touch coordinates to drag image coordinates
    // defaults to (0,0)
    dragImageOffset?:Point;

    // if the dragImage shall be centered on the touch coordinates
    // defaults to false
    dragImageCenterOnTouch?:boolean;

    // the drag and drop operation involves some processing. here you can specify in what interval this processing takes place.
    // defaults to 150ms
    iterationInterval?:number;

    // hook for custom logic that decides if a drag operation should start
    dragStartConditionOverride?:( event:TouchEvent ) => boolean;

    // hook for custom logic that can manipulate the drag image translate offset
    dragImageTranslateOverride?:DragImageTranslateOverrideFn;

    // hook for custom logic that can override the default action based on the original touch event when the drag never started
    // be sure to call event.preventDefault() if handling the default action in the override to prevent the browser default.
    defaultActionOverride?:( event:TouchEvent ) => void;

    // Drag action delay on touch devices ("hold to drag" functionality, useful for scrolling draggable items). Defaults to no delay.
    holdToDrag?:number;

    // function invoked for each touchstart event to determine if and which touched element is detected as "draggable"
    tryFindDraggableTarget?:( event:TouchEvent ) => HTMLElement | undefined;

    // function for creating a copy of the dragged element
    dragImageSetup?:( element:HTMLElement ) => HTMLElement;

    // function for determining element that is currently hovered while dragging
    // defaults to `document.elementFromPoint()`
    elementFromPoint?:( x:number, y:number ) => Element;
}

export function polyfill( override?:Config ):boolean {

    if( override ) {
        // overwrite default config with user config
        Object.keys( override ).forEach( function( key ) {
            config[ key ] = override[ key ];
        } );
    }

    // only do feature detection when config does not force apply the polyfill
    if( !config.forceApply ) {

        // feature/browser detection
        const detectedFeatures = detectFeatures();

        // if( DEBUG ) {
        //     Object.keys( detectedFeatures ).forEach( function( key ) {
        //         console.log( "dnd-poly: detected feature '" + key + " = " + detectedFeatures[ key ] + "'" );
        //     } );
        // }

        // check if native drag and drop support is there
        if( detectedFeatures.userAgentSupportingNativeDnD
            && detectedFeatures.draggable
            && detectedFeatures.dragEvents ) {
            // no polyfilling required
            return false;
        }
    }

    console.log( "dnd-poly: Applying mobile drag and drop polyfill." );

    // add listeners suitable for detecting a potential drag operation
    if( config.holdToDrag ) {
        console.log("dnd-poly: holdToDrag set to " + config.holdToDrag);
        addDocumentListener( "touchstart", onDelayTouchstart, false );
    } else {
        addDocumentListener( "touchstart", onTouchstart, false );
    }

    return true;
}

//</editor-fold>
