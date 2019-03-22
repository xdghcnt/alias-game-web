function sketcher(canvas_container, socket, state) {
    this.canvas_container = canvas_container;
    this.state = state;
    this.active = false;

    this.width = this.canvas_container.offsetWidth;
    this.height = this.canvas_container.offsetHeight;

    this.lastMousePoint = {x: 0, y: 0};
    this.dots = [];

    this.scale_x = 1.0;
    this.scale_y = 1.0;

    // creating permanent canvas
    this.permanent_canvas = document.createElement("canvas");
    this.permanent_canvas.id = "permanent_canvas";
    this.permanent_canvas.width = this.width;
    this.permanent_canvas.height = this.height;
    this.permanent_canvas.style.cssText = "position: absolute; left: " + this.canvas_container.getBoundingClientRect().left + "px; top: " + this.canvas_container.getBoundingClientRect().top + "px; z-index:100; max-width: 100%; max-height: 100%;";
    this.canvas_container.appendChild(this.permanent_canvas);
    this.permanent_context = this.permanent_canvas.getContext("2d");

    // creating a collaboration canvas
    this.collaboration_canvas = document.createElement("canvas");
    this.collaboration_context = this.collaboration_canvas.getContext("2d");
    this.collaboration_canvas.id = "collaboration_canvas";
    this.collaboration_canvas.width = this.width;
    this.collaboration_canvas.height = this.height;
    this.collaboration_canvas.style.cssText = "position: absolute; left: " + this.canvas_container.getBoundingClientRect().left + "px; top: " + this.canvas_container.getBoundingClientRect().top + "px; z-index:101; max-width: 100%; max-height: 100%;";
    this.canvas_container.appendChild(this.collaboration_canvas);

    // creating a temporary canvas
    this.temp_canvas = document.createElement("canvas");
    this.temp_context = this.temp_canvas.getContext("2d");
    this.temp_canvas.id = "temp_canvas";
    this.temp_canvas.width = this.width;
    this.temp_canvas.height = this.height;
    this.temp_canvas.style.cssText = "position: absolute; left: " + this.canvas_container.getBoundingClientRect().left + "px; top: " + this.canvas_container.getBoundingClientRect().top + "px; cursor: crosshair; z-index:102; max-width: 100%; max-height: 100%;";
    this.canvas_container.appendChild(this.temp_canvas);

    this.temp_context.strokeStyle = "#000000";
    this.temp_context.fillStyle = "#000000";
    this.temp_context.lineWidth = 2;
    this.temp_context.lineJoin = "round";
    this.temp_context.lineCap = "round";

    this.touch_supported = 'ontouchstart' in document.documentElement;
    if (this.touch_supported) {
        this.mouse_down_event = "touchstart";
        this.mouse_move_event = "touchmove";
        this.mouse_up_event = "touchend";
    } else {
        this.mouse_down_event = "mousedown";
        this.mouse_move_event = "mousemove";
        this.mouse_up_event = "mouseup";
    }

    this.reallign_width_parent_div();

    this.temp_canvas.addEventListener(this.mouse_down_event, this.on_canvas_mouse_down());

    // connecting to collaboration socket
    this.collaboration_socket = socket;
    var self = this;
    this.collaboration_socket.on("draw-commit", function (drawList) {
        drawList.forEach((data) => {
            self.draw_quadratic_curve(data['dots'], data['color'], data['thickness'], self.permanent_context);
        });
    }.bind());
    this.collaboration_socket.on("draw-clear", function () {
        self.permanent_context.clearRect(0, 0, self.width, self.height);
        self.collaboration_context.clearRect(0, 0, self.width, self.height);
        self.temp_context.clearRect(0, 0, self.width, self.height);
    }.bind());

    this.collaboration_socket.on("draw-add", function (data) {
        self.collaboration_context.clearRect(0, 0, self.width, self.height);
        self.draw_quadratic_curve(data['dots'], data['color'], data['thickness'], self.collaboration_context);
    }.bind());

    this.setActive(this.active, true);
}


sketcher.prototype.on_canvas_mouse_down = function () {
    var self = this;
    return function (event) {
        if (self.active) {
            event.preventDefault();
            self.mouse_move_handler = self.on_canvas_mouse_move();
            self.mouse_up_handler = self.on_canvas_mouse_up();

            window.addEventListener(self.mouse_move_event, self.mouse_move_handler);
            window.addEventListener(self.mouse_up_event, self.mouse_up_handler);

            self.update_mouse_position(event);
            self.update_canvas_by_quadratic_curve(event);
        }
    }
};


sketcher.prototype.on_canvas_mouse_move = function () {
    var self = this;
    return function (event) {
        event.preventDefault();
        self.update_canvas_by_quadratic_curve(event);
        if (!self.state.drawCommitOnly)
            self.collaboration_socket.emit("draw-add", {'dots': self.dots, 'color': "#000000", 'thickness': 2});
        return false;
    }
};


sketcher.prototype.on_canvas_mouse_up = function (event) {
    var self = this;
    return function (event) {
        var copy_dots = self.dots;
        self.dots = [];
        self.draw_quadratic_curve(copy_dots, "#000000", 2, self.permanent_context);
        self.temp_context.clearRect(0, 0, this.temp_canvas.width, this.temp_canvas.height);

        self.collaboration_socket.emit("draw-commit", {'dots': copy_dots, 'color': "#000000", 'thickness': 2});

        window.removeEventListener(self.mouse_move_event, self.mouse_move_handler);
        window.removeEventListener(self.mouse_up_event, self.mouse_up_handler);

        self.mouse_move_handler = null;
        self.mouse_up_handler = null;
    }
};


sketcher.prototype.update_mouse_position = function (event) {
    var target;
    if (this.touch_supported) {
        target = event.touches[0];
    } else {
        target = event;
    }

    this.lastMousePoint.x = target.pageX - this.permanent_canvas.offsetLeft;
    this.lastMousePoint.y = target.pageY - this.permanent_canvas.offsetTop;

    this.lastMousePoint.x /= this.scale_x;
    this.lastMousePoint.y /= this.scale_y;

    var coordinates = {x: this.lastMousePoint.x, y: this.lastMousePoint.y};

    if (this.dots.length < 1 || this.dots[this.dots.length - 1].x != coordinates.x || this.dots[this.dots.length - 1].y != coordinates.y) {
        this.dots.push(coordinates);
    }
    // shitty iPad palm detection
    if (this.dots.length > 1 && Math.sqrt(Math.pow(this.dots[this.dots.length - 1].x - this.dots[this.dots.length - 2].x, 2) + Math.pow(this.dots[this.dots.length - 1].y - this.dots[this.dots.length - 2].y, 2)) > (this.width + this.height) * 15 / 100) {
        var shift_x_times = this.dots.length - 1;
        while (shift_x_times > 0) {
            this.dots.shift();
            shift_x_times--;
        }
    }
};


sketcher.prototype.update_canvas_by_quadratic_curve = function (event) {
    this.update_mouse_position(event);

    // temp canvas is always cleared up before drawing.
    this.temp_context.clearRect(0, 0, this.temp_canvas.width, this.temp_canvas.height);
    this.draw_quadratic_curve(this.dots, "#000000", 2, this.temp_context);
};


sketcher.prototype.draw_quadratic_curve = function (dots, color, thickness, target) {

    color = !this.invert ? color : "#cccaca";

    target.strokeStyle = color;
    target.fillStyle = color;
    target.lineWidth = thickness;
    target.lineJoin = "round";
    target.lineCap = "round";

    if (dots.length > 0) { // just in case
        if (dots.length < 3) {
            var b = dots[0];
            target.beginPath();
            target.arc(b.x, b.y, target.lineWidth / 2, 0, Math.PI * 2, !0);
            target.fill();
            target.closePath();

            return;
        }

        target.beginPath();
        target.moveTo(dots[0].x, dots[0].y);

        for (var i = 1; i < dots.length - 2; i++) {
            var c = (dots[i].x + dots[i + 1].x) / 2;
            var d = (dots[i].y + dots[i + 1].y) / 2;

            target.quadraticCurveTo(dots[i].x, dots[i].y, c, d);
        }

        // the last 2 points are special
        target.quadraticCurveTo(dots[i].x, dots[i].y, dots[i + 1].x, dots[i + 1].y);
        target.stroke();
    }
};


sketcher.prototype.reallign_width_parent_div = function () {
    this.permanent_canvas.style.cssText = "position: absolute; left: " + this.canvas_container.getBoundingClientRect().left + "px; top: " + this.canvas_container.getBoundingClientRect().top + "px; z-index:100; max-width: 100%; max-height: 100%; width:" + this.canvas_container.style.width + "; height:" + this.canvas_container.style.height + ";";
    this.collaboration_canvas.style.cssText = "position: absolute; left: " + this.canvas_container.getBoundingClientRect().left + "px; top: " + this.canvas_container.getBoundingClientRect().top + "px; z-index:101; max-width: 100%; max-height: 100%; width:" + this.canvas_container.style.width + "; height:" + this.canvas_container.style.height + ";";
    this.temp_canvas.style.cssText = "position: absolute; left: " + this.canvas_container.getBoundingClientRect().left + "px; top: " + this.canvas_container.getBoundingClientRect().top + "px; cursor: crosshair; z-index:102; max-width: 100%; max-height: 100%; width:" + this.canvas_container.style.width + "; height:" + this.canvas_container.style.height + ";";
    this.scale_x = this.permanent_canvas.getBoundingClientRect().width / this.width;
    this.scale_y = this.permanent_canvas.getBoundingClientRect().height / this.height;
    this.setActive(this.active, true);
};


sketcher.prototype.setActive = function (state, forceUpdate) {
    if (forceUpdate || this.active !== state) {
        var cursor = state ? "crosshair" : "default";
        this.permanent_canvas.style.cursor = cursor;
        this.collaboration_canvas.style.cursor = cursor;
        this.temp_canvas.style.cursor = cursor;
    }
    this.active = state;
};


sketcher.prototype.setInvert = function (state) {
    this.invert = state;
};


sketcher.prototype.updateState = function (state) {
    this.state = state;
};


window.Sketcher = sketcher;