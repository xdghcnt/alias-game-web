const timers = {};

function fireTimeout(id) {
    this.postMessage({id: id});
    delete timers[id];
}

this.addEventListener("message", function (evt) {
    const data = evt.data;
    let timer, time;

    switch (data.command) {
        case "setTimeout":
            time = parseInt(data.timeout || 0, 10);
            timers[data.id] = setTimeout(fireTimeout.bind(null, data.id), time);
            break;
        case "clearTimeout":
            timer = timers[data.id];
            if (timer) clearTimeout(timer);
            delete timers[data.id];
    }
});