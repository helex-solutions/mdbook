export { HelloWorld } from './tree/component';
export * from './tree/template';
export declare function initializeWebComponent(name?: string): void;
interface InitializeParams {
    container?: HTMLElement;
    startOnLoad?: boolean;
    querySelector?: string;
}
export declare function initialize(options?: InitializeParams): void;
