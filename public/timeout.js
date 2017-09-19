let timeoutId = 0;
const timeouts = {};

const worker = new Worker("timeout-worker.js");
worker.addEventListener("message", function (evt) {
    const
        data = evt.data,
        id = data.id,
        fn = timeouts[id].fn,
        args = timeouts[id].args;

    fn.apply(null, args);
    delete timeouts[id];
});

window.setTimeout = function (fn, delay) {
    const args = Array.prototype.slice.call(arguments, 2);
    timeoutId += 1;
    delay = delay || 0;
    const id = timeoutId;
    timeouts[id] = {fn: fn, args: args};
    worker.postMessage({command: "setTimeout", id: id, timeout: delay});
    return id;
};

window.clearTimeout = function (id) {
    worker.postMessage({command: "clearTimeout", id: id});
    delete timeouts[id];
};