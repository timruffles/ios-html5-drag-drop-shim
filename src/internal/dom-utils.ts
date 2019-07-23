import { CLASS_DRAG_IMAGE_SNAPBACK } from "./constants";
import { supportsPassiveEventListener } from "./feature-detection";

// evaluate once on startup
const supportsPassive = supportsPassiveEventListener();

export interface Point {
    x:number;
    y:number;
}

export function isDOMElement( object:Element ) {
    return object && object.tagName;
}

export function addDocumentListener( ev:string, handler:EventListener, passive:boolean = true ) {
    document.addEventListener( ev, handler, supportsPassive ? { passive: passive } : false );
}

export function removeDocumentListener( ev:string, handler:EventListener ) {
    document.removeEventListener( ev, handler );
}

export function onEvt(el:EventTarget, event:string, handler:EventListener, capture:boolean = false) {

    const options = supportsPassive ? {passive: true, capture: capture} : capture;

    el.addEventListener(event, handler, options);

    return {
        off() {
            el.removeEventListener(event, handler, options as any);
        }
    };
}

function prepareNodeCopyAsDragImage( srcNode:HTMLElement, dstNode:HTMLElement, firstNode:boolean ) {

    // Is this node an element?
    if( srcNode.nodeType === 1 ) {

        // Clone the style
        const cs = getComputedStyle( srcNode );
        for( let i = 0; i < cs.length; i++ ) {
            const csName = cs[ i ];
            dstNode.style.setProperty( csName, cs.getPropertyValue( csName ), cs.getPropertyPriority( csName ) );
        }
        
        // remove potential conflict if first node has transform
        if( firstNode ) {
            dstNode.style.transform = "";
        }

        // no interaction with the drag image, pls! this is also important to make the drag image transparent for hit-testing
        // hit testing is done in the drag and drop iteration to find the element the user currently is hovering over while dragging.
        // if pointer-events is not none or a browser does behave in an unexpected way than the hit test transparency on the drag image
        // will break
        dstNode.style.pointerEvents = "none";

        // Remove any potential conflict attributes
        dstNode.removeAttribute( "id" );
        dstNode.removeAttribute( "class" );
        dstNode.removeAttribute( "draggable" );

        // canvas elements need special handling by copying canvas image data
        if( dstNode.nodeName === "CANVAS" ) {

            const canvasSrc = srcNode as HTMLCanvasElement;
            const canvasDst = dstNode as HTMLCanvasElement;

            const canvasSrcImgData = canvasSrc.getContext( "2d" ).getImageData( 0, 0, canvasSrc.width, canvasSrc.height );

            canvasDst.getContext( "2d" ).putImageData( canvasSrcImgData, 0, 0 );
        }
    }

    // Do the same for the children
    if( srcNode.hasChildNodes() ) {

        for( let i = 0; i < srcNode.childNodes.length; i++ ) {

            prepareNodeCopyAsDragImage( <HTMLElement>srcNode.childNodes[ i ], <HTMLElement>dstNode.childNodes[ i ], false );
        }
    }
}

export function createDragImage( sourceNode:HTMLElement ):HTMLElement {

    const dragImage = <HTMLElement>sourceNode.cloneNode( true );

    // this removes any id's and stuff that could interfere with drag and drop
    prepareNodeCopyAsDragImage( sourceNode, dragImage, true );

    return dragImage;
}

function average( array:Array<number> ) {
    if( array.length === 0 ) {
        return 0;
    }
    return array.reduce( (function( s, v ) {
        return v + s;
    }), 0 ) / array.length;
}

export function isTouchIdentifierContainedInTouchEvent( touchEvent:TouchEvent, touchIdentifier:number ) {
    for( let i = 0; i < touchEvent.changedTouches.length; i++ ) {
        const touch = touchEvent.changedTouches[ i ];
        if( touch.identifier === touchIdentifier ) {
            return true;
        }
    }
    return false;
}

/**
 * Calc center of polygon spanned by multiple touches in page (full page size, with hidden scrollable area) coordinates
 * or in viewport (screen coordinates) coordinates.
 */
export function updateCentroidCoordinatesOfTouchesIn( coordinateProp:"page" | "client", event:TouchEvent, outPoint:Point ):void {
    const pageXs:Array<number> = [], pageYs:Array<number> = [];
    for( let i = 0; i < event.touches.length; i++ ) {
        const touch = event.touches[ i ];
        pageXs.push( touch[ coordinateProp + "X" ] );
        pageYs.push( touch[ coordinateProp + "Y" ] );
    }
    outPoint.x = average( pageXs );
    outPoint.y = average( pageYs );
}

// cross-browser css transform property prefixes
const TRANSFORM_CSS_VENDOR_PREFIXES = [ "", "-webkit-" ];

export function extractTransformStyles( sourceNode:HTMLElement ):string[] {

    return TRANSFORM_CSS_VENDOR_PREFIXES.map( function( prefix:string ) {

        let transform = sourceNode.style[ prefix + "transform" ];

        if( !transform || transform === "none" ) {
            return "";
        }

        // removes translate(x,y)
        return transform.replace( /translate\(\D*\d+[^,]*,\D*\d+[^,]*\)\s*/g, "" );
    } );
}

export function translateElementToPoint( element:HTMLElement, pnt:Point, originalTransforms:string[], offset?:Point, centerOnCoordinates = true ):void {

    let x = pnt.x, y = pnt.y;

    if( offset ) {
        x += offset.x;
        y += offset.y;
    }

    if( centerOnCoordinates ) {
        x -= (parseInt( <any>element.offsetWidth, 10 ) / 2);
        y -= (parseInt( <any>element.offsetHeight, 10 ) / 2);
    }

    // using translate3d for max performance
    const translate = "translate3d(" + x + "px," + y + "px, 0)";

    for( let i = 0; i < TRANSFORM_CSS_VENDOR_PREFIXES.length; i++ ) {
        const transformProp = TRANSFORM_CSS_VENDOR_PREFIXES[ i ] + "transform";
        element.style[ transformProp ] = translate + " " + originalTransforms[ i ];
    }
}

/**
 * calculates the coordinates of the drag source and transitions the drag image to those coordinates.
 * the drag operation is finished after the transition has ended.
 */
export function applyDragImageSnapback( sourceEl:HTMLElement, dragImage:HTMLElement, dragImageTransforms:string[], transitionEndCb:Function ):void {

    const cs = getComputedStyle( sourceEl );

    if( cs.visibility === "hidden" || cs.display === "none" ) {
        console.log( "dnd-poly: source node is not visible. skipping snapback transition." );
        // shortcut to end the drag operation
        transitionEndCb();
        return;
    }
    // add class containing transition rules
    dragImage.classList.add( CLASS_DRAG_IMAGE_SNAPBACK );

    const csDragImage = getComputedStyle( dragImage );
    const durationInS = parseFloat( csDragImage.transitionDuration );
    if( isNaN( durationInS ) || durationInS === 0 ) {
        console.log( "dnd-poly: no transition used - skipping snapback" );
        transitionEndCb();
        return;
    }

    console.log( "dnd-poly: starting dragimage snap back" );

    // calc source node position
    const rect = sourceEl.getBoundingClientRect();

    const pnt:Point = {
        x: rect.left,
        y: rect.top
    };

    // add scroll offset of document
    pnt.x += (document.body.scrollLeft || document.documentElement.scrollLeft);
    pnt.y += (document.body.scrollTop || document.documentElement.scrollTop);

    //TODO this sometimes fails to calculate the correct origin position.. find out when exactly and how to detect
    pnt.x -= parseInt( cs.marginLeft, 10 );
    pnt.y -= parseInt( cs.marginTop, 10 );

    const delayInS = parseFloat( csDragImage.transitionDelay );
    const durationInMs = Math.round( (durationInS + delayInS) * 1000 );

    // apply the translate
    translateElementToPoint( dragImage, pnt, dragImageTransforms, undefined, false );

    setTimeout( transitionEndCb, durationInMs );
}
