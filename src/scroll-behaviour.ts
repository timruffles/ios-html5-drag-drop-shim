//<editor-fold desc="static scroll utils">

import { DragImageTranslateOverrideFn } from "./index";
import { Point } from "./internal/dom-utils";

interface ScrollIntentions {
    horizontal:ScrollIntention;
    vertical:ScrollIntention;
}

interface IScrollBounds {
    x:number;
    y:number;
    width:number;
    height:number;
    scrollX:number;
    scrollY:number;
    scrollHeight:number;
    scrollWidth:number;
}

const enum ScrollIntention {
    NONE = 0,
    LEFT_OR_TOP = -1,
    RIGHT_OR_BOTTOM = 1
}

const enum ScrollAxis {
    HORIZONTAL,
    VERTICAL
}

function isTopLevelEl( el:HTMLElement ):boolean {

    return (el === document.body || el === document.documentElement);
}

function getElementViewportOffset( el:HTMLElement, axis:ScrollAxis ) {
    let offset:number;

    if( isTopLevelEl( el ) ) {
        offset = (axis === ScrollAxis.HORIZONTAL) ? el.clientLeft : el.clientTop;
    }
    else {
        const bounds = el.getBoundingClientRect();
        offset = (axis === ScrollAxis.HORIZONTAL) ? bounds.left : bounds.top;
    }

    return offset;
}

function getElementViewportSize( el:HTMLElement, axis:ScrollAxis ) {
    if(isTopLevelEl( el )) {
        return (axis === ScrollAxis.HORIZONTAL) ? Math.min(el.clientWidth, window.innerWidth) : Math.min(el.clientHeight, window.innerHeight);
    }
    return (axis === ScrollAxis.HORIZONTAL) ? el.clientWidth : el.clientHeight;
}

function getSetElementScroll( el:HTMLElement, axis:ScrollAxis, scroll?:number ) {
    const prop = (axis === ScrollAxis.HORIZONTAL) ? "scrollLeft" : "scrollTop";

    // abstracting away compatibility issues on scroll properties of document/body
    const isTopLevel = isTopLevelEl( el );

    if( arguments.length === 2 ) {

        if( isTopLevel ) {
            return document.body[ prop ] || document.documentElement[ prop ];
        }

        return el[ prop ];
    }

    if( isTopLevel ) {
        document.documentElement[ prop ] += scroll;
        document.body[ prop ] += scroll;
    }
    else {
        el[ prop ] += scroll;
    }
}

//TODO check if scroll end is reached according to scroll intention? this is needed to implement scroll chaining
function isScrollable( el:HTMLElement ):boolean {

    if( el.scrollHeight > el.clientHeight ) {

        if( el === document.documentElement ) {
            return true;
        }

        const cs = getComputedStyle( el );
        return cs.overflowY === "scroll" || cs.overflowY === "auto";
    }

    if( el.scrollWidth > el.clientWidth ) {

        if( el === document.documentElement ) {
            return true;
        }

        const cs = getComputedStyle( el );
        return cs.overflowX === "scroll" || cs.overflowX === "auto";
    }

    return false;
}

function findScrollableParent( el:HTMLElement ):HTMLElement {
    do {
        if( !el ) {
            return undefined;
        }
        if( isScrollable( el ) ) {
            return el;
        }
        if( el === document.documentElement ) {
            return null;
        }
    } while( el = <HTMLElement>el.parentNode );
    return null;
}

function determineScrollIntention( currentCoordinate:number, size:number, threshold:number ):ScrollIntention {

    // LEFT / TOP
    if( currentCoordinate < threshold ) {
        return ScrollIntention.LEFT_OR_TOP;
    }
    // RIGHT / BOTTOM
    else if( size - currentCoordinate < threshold ) {
        return ScrollIntention.RIGHT_OR_BOTTOM;
    }
    // NONE
    return ScrollIntention.NONE;
}

function determineDynamicVelocity( scrollIntention:ScrollIntention, currentCoordinate:number, size:number, threshold:number ):number {

    if( scrollIntention === ScrollIntention.LEFT_OR_TOP ) {

        return Math.abs( currentCoordinate - threshold );
    }
    else if( scrollIntention === ScrollIntention.RIGHT_OR_BOTTOM ) {

        return Math.abs( size - currentCoordinate - threshold );
    }

    return 0;
}

function isScrollEndReached( axis:ScrollAxis, scrollIntention:ScrollIntention, scrollBounds:IScrollBounds ) {

    const currentScrollOffset = (axis === ScrollAxis.HORIZONTAL) ? (scrollBounds.scrollX) : (scrollBounds.scrollY);

    // wants to scroll to the right/bottom
    if( scrollIntention === ScrollIntention.RIGHT_OR_BOTTOM ) {

        const maxScrollOffset = (axis === ScrollAxis.HORIZONTAL) ? (scrollBounds.scrollWidth - scrollBounds.width) : (scrollBounds.scrollHeight -
            scrollBounds.height);

        // is already at the right/bottom edge
        return currentScrollOffset >= maxScrollOffset;
    }
    // wants to scroll to the left/top
    else if( scrollIntention === ScrollIntention.LEFT_OR_TOP ) {

        // is already at left/top edge
        return (currentScrollOffset <= 0);
    }
    // no scroll
    return true;
}

//</editor-fold>

let _options:ScrollOptions = {
    threshold: 75,
    // simplified cubic-ease-in function
    velocityFn: function( velocity:number, threshold:number ) {
        const multiplier = velocity / threshold;
        const easeInCubic = multiplier * multiplier * multiplier;
        return easeInCubic * threshold;
    }
};

let _scrollIntentions:ScrollIntentions = {
    horizontal: ScrollIntention.NONE,
    vertical: ScrollIntention.NONE
};

let _dynamicVelocity:Point = {
    x: 0,
    y: 0
};

let _scrollAnimationFrameId:any;
let _currentCoordinates:Point;
let _hoveredElement:HTMLElement;
let _scrollableParent:HTMLElement;
let _translateDragImageFn:( offsetX:number, offsetY:number ) => void;
let _scrollableParentBounds:IScrollBounds;

/**
 * core handler function
 */
function handleDragImageTranslateOverride( event:TouchEvent,
                                           currentCoordinates:Point,
                                           hoveredElement:HTMLElement,
                                           translateDragImageFn:( scrollDiffX:number, scrollDiffY:number ) => void ):void {

    _currentCoordinates = currentCoordinates;
    _translateDragImageFn = translateDragImageFn;

    // update parent if hovered element changed
    if( _hoveredElement !== hoveredElement ) {

        _hoveredElement = hoveredElement;
        _scrollableParent = findScrollableParent( _hoveredElement );
    }

    // update scroll intention and check if we should scroll at all
    //TODO implement scroll chaining? if scroll end is reached continue to look for scrollable parent
    const performScrollAnimation = updateScrollIntentions( _currentCoordinates, _scrollableParent, _options.threshold, _scrollIntentions, _dynamicVelocity );

    // no animation in progress but scroll is intended
    if( performScrollAnimation ) {

        // setup scroll animation frame
        scheduleScrollAnimation();
    }
    else if( !!_scrollAnimationFrameId ) {

        window.cancelAnimationFrame( _scrollAnimationFrameId );
        _scrollAnimationFrameId = null;
    }
}

//<editor-fold desc="programmatic scroll animation frame handler">

function scheduleScrollAnimation() {

    // prevent scheduling when already scheduled
    if( !!_scrollAnimationFrameId ) {

        return;
    }

    _scrollAnimationFrameId = window.requestAnimationFrame( scrollAnimation );
}

function scrollAnimation() {

    let scrollDiffX = 0,
        scrollDiffY = 0,
        isTopLevel = isTopLevelEl( _scrollableParent );

    if( _scrollIntentions.horizontal !== ScrollIntention.NONE ) {

        scrollDiffX = Math.round( _options.velocityFn( _dynamicVelocity.x, _options.threshold ) * _scrollIntentions.horizontal );
        getSetElementScroll( _scrollableParent, ScrollAxis.HORIZONTAL, scrollDiffX );
    }

    if( _scrollIntentions.vertical !== ScrollIntention.NONE ) {

        scrollDiffY = Math.round( _options.velocityFn( _dynamicVelocity.y, _options.threshold ) * _scrollIntentions.vertical );
        getSetElementScroll( _scrollableParent, ScrollAxis.VERTICAL, scrollDiffY );
    }

    if( isTopLevel ) {
        // on top level element scrolling we need to translate the drag image as much as we scroll
        _translateDragImageFn( scrollDiffX, scrollDiffY );
    }
    else {
        // just scroll the container and update the drag image position without offset
        _translateDragImageFn( 0, 0 );
    }

    // reset to make sure we can re-schedule scroll animation
    _scrollAnimationFrameId = null;

    // check if we should continue scrolling
    //TODO implement scroll chaining? if scroll end is reached continue to look for scrollable parent
    if( updateScrollIntentions( _currentCoordinates, _scrollableParent, _options.threshold, _scrollIntentions, _dynamicVelocity ) ) {

        // re-schedule animation frame callback
        scheduleScrollAnimation();
    }
}

//</editor-fold>

//<editor-fold desc="scroll checks">

function updateScrollIntentions( currentCoordinates:Point,
                                 scrollableParent:HTMLElement,
                                 threshold:number,
                                 scrollIntentions:ScrollIntentions,
                                 dynamicVelocity:Point ):boolean {

    if( !currentCoordinates || !scrollableParent ) {

        // when coordinates become undefined drag operation stopped. stop scrolling also.
        return false;
    }

    const updateScrollWidth:boolean = _scrollableParentBounds === undefined || _scrollableParentBounds.scrollWidth === undefined || scrollableParent === undefined;
    const updateScrollHeight:boolean = _scrollableParentBounds === undefined || _scrollableParentBounds.scrollHeight === undefined || scrollableParent === undefined;
    _scrollableParentBounds = {
        x: getElementViewportOffset( scrollableParent, ScrollAxis.HORIZONTAL ),
        y: getElementViewportOffset( scrollableParent, ScrollAxis.VERTICAL ),
        width: getElementViewportSize( scrollableParent, ScrollAxis.HORIZONTAL ),
        height: getElementViewportSize( scrollableParent, ScrollAxis.VERTICAL ),
        scrollX: getSetElementScroll( scrollableParent, ScrollAxis.HORIZONTAL ),
        scrollY: getSetElementScroll( scrollableParent, ScrollAxis.VERTICAL ),
        scrollWidth: updateScrollWidth ? scrollableParent.scrollWidth : _scrollableParentBounds.scrollWidth,
        scrollHeight: updateScrollHeight ? scrollableParent.scrollHeight : _scrollableParentBounds.scrollHeight
    };
    const currentCoordinatesOffset = {
        x: currentCoordinates.x - _scrollableParentBounds.x,
        y: currentCoordinates.y - _scrollableParentBounds.y
    };

    scrollIntentions.horizontal = determineScrollIntention( currentCoordinatesOffset.x, _scrollableParentBounds.width, threshold );
    scrollIntentions.vertical = determineScrollIntention( currentCoordinatesOffset.y, _scrollableParentBounds.height, threshold );

    if( scrollIntentions.horizontal && isScrollEndReached( ScrollAxis.HORIZONTAL, scrollIntentions.horizontal, _scrollableParentBounds ) ) {

        // if scroll end is reached, reset to none
        scrollIntentions.horizontal = ScrollIntention.NONE;
    }
    else if( scrollIntentions.horizontal ) {

        dynamicVelocity.x = determineDynamicVelocity( scrollIntentions.horizontal, currentCoordinatesOffset.x, _scrollableParentBounds.width, threshold );
    }

    if( scrollIntentions.vertical && isScrollEndReached( ScrollAxis.VERTICAL, scrollIntentions.vertical, _scrollableParentBounds ) ) {

        // if scroll end is reached, reset to none
        scrollIntentions.vertical = ScrollIntention.NONE;
    }
    else if( scrollIntentions.vertical ) {

        dynamicVelocity.y = determineDynamicVelocity( scrollIntentions.vertical, currentCoordinatesOffset.y, _scrollableParentBounds.height, threshold );
    }

    return !!(scrollIntentions.horizontal || scrollIntentions.vertical);
}

//</editor-fold>

//<editor-fold desc="public api">

export interface ScrollOptions {
    // threshold in px. when distance between scrollable element edge and touch position is smaller start programmatic scroll.
    // defaults to 75px
    threshold?:number;
    // function to customize the scroll velocity
    // velocity param: distance to scrollable element edge
    // threshold: the threshold used to determine when scrolling should start
    // defaults to cubic-ease-in.
    velocityFn:( velocity:number, threshold:number ) => number;
}

export const scrollBehaviourDragImageTranslateOverride:DragImageTranslateOverrideFn = handleDragImageTranslateOverride;

//</editor-fold>
