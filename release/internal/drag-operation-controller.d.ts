import { Config } from "../index";
export declare const enum DragOperationState {
    POTENTIAL = 0,
    STARTED = 1,
    ENDED = 2,
    CANCELLED = 3,
}
export declare class DragOperationController {
    private _initialEvent;
    private _config;
    private _sourceNode;
    private _dragOperationEndedCb;
    private _dragOperationState;
    private _dragImage;
    private _dragImageTransforms;
    private _dragImagePageCoordinates;
    private _dragImageOffset;
    private _currentHotspotCoordinates;
    private _immediateUserSelection;
    private _currentDropTarget;
    private _dragDataStore;
    private _dataTransfer;
    private _currentDragOperation;
    private _initialTouch;
    private _touchMoveHandler;
    private _touchEndOrCancelHandler;
    private _lastTouchEvent;
    private _iterationLock;
    private _iterationIntervalId;
    constructor(_initialEvent: TouchEvent, _config: Config, _sourceNode: HTMLElement, _dragOperationEndedCb: (config: Config, event: TouchEvent, state: DragOperationState) => void);
    private _setup();
    cleanup();
    private _onTouchMove(event);
    private _onTouchEndOrCancel(event);
    private _dragAndDropProcessModelIteration();
    private _dragOperationEnded(state);
    private _finishDragOperation();
}
