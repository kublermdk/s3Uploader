// Based on https://stackoverflow.com/a/47112177/7299352

/**
 * Deferred Promise
 *
 * A promise which can be used without the rest of the code being wrapped in the callback method.
 *
 * @class
 * @property {function} resolve
 * @property {function} reject
 * @property {function} then
 * @property {function} catch
 * @example
 let promises = [];
 let each = _.each([0, 1, 3, 10], async (value, index) => {
    let newPromise = new DeferredPromise();
    setTimeout(() => {
        console.log("The delayed value and index:", {value, index});
        newPromise.resolve(value); // This is the main point, you can resolve the promise without having to have it in a function block
    }, value * 100);
    promises.push(newPromise);
});
 await Promise.all(promises);
 console.log("Each completed: ", each);


 */
class DeferredPromise {
    resolve; // Replaced in the constructor
    reject; // Replaced in the constructor
    then; // Replaced in the constructor
    catch; // Replaced in the constructor
    constructor() {
        this._promise = new Promise((resolve, reject) => {
            // assign the resolve and reject functions to `this`
            // making them usable on the class instance
            this.resolve = resolve;
            this.reject = reject;
        });
        // bind `then` and `catch` to implement the same interface as Promise
        this.then = this._promise.then.bind(this._promise);
        this.catch = this._promise.catch.bind(this._promise);
        this[Symbol.toStringTag] = 'Promise';
    }
}

module.exports = DeferredPromise;
