let code_mirror = null;
function save_note(button, textarea, input) {
  let note = textarea.value;
  if (code_mirror) {
    note = code_mirror.doc.getValue();
  }
  let name_pass = input.value.split('#');
  let name = encodeURIComponent(name_pass[0]);
  if (name == '') {
    alert("Note needs a name");
    return;
  }
  let pass = '';
  if (name_pass.length > 1) {
    pass = encodeURIComponent(name_pass[1]);
  }
  let httpRequest = new XMLHttpRequest();
  httpRequest.onreadystatechange = function(){
    if (httpRequest.readyState == 4) {
      if (httpRequest.status != 200) {
        alert("Error: " + httpRequest.response);
      } else {
        var newurl = window.location.origin +
          '/edit/animation/' +
          name;
        window.history.pushState(
          { path: newurl }, 
          '', 
          newurl);
        button.classList.toggle('dimmed', true);
        button.onclick = function() {};
        setTimeout(function(){
          button.classList.toggle('dimmed', false);
          button.onclick = function() {save_note(
            this,
            document.getElementById('note'),
            document.getElementById('name')
          )};

        }, 5000);
      }
    }
  };
  httpRequest.open('POST',
    window.location.origin +
    '/save/note/' +
    name + '/' + pass,
    true);
  httpRequest.setRequestHeader('Content-Type', 'application/json');
  httpRequest.send(JSON.stringify({
    note: note})
  );
}

let canvas = null;
let __interval = null;
let __num_frames = 100;
let __framerate = 20;
let __width = 300;
let __height = 200;
let __background_color = 'white';

function updateFramerate(target) {
  __framerate = Number.parseInt(target.value);
  render();
}
function updateHeight(target) {
  __height = Number.parseInt(target.value);
  render();
}
function updateWidth(target) {
  __width = Number.parseInt(target.value);
  render();
}
function updateNumFrames(target) {
  __num_frames = Number.parseInt(target.value);
  render();
}
function render_error(err, target) {
  canvas.width  = 0;
  canvas.height = 0;
  canvas.style.width  = 0 + 'px';
  canvas.style.height = 0 + 'px';
  let errDiv = document.getElementById('error');
  errDiv.textContent = err + '\n\n' + err.stack;
}

function render_impl(contents, target, capturer = null) {
  document.getElementById('error').textContent = '';
  document.getElementById('framerate').value = __framerate;
  document.getElementById('frames').value = __num_frames;
  document.getElementById('width').value = __width;
  document.getElementById('height').value = __height;

  if (canvas == null) {
    canvas = document.getElementById('canvas');
  }
  canvas.width  = __width;
  canvas.height = __height;
  canvas.style.width  = __width + 'px';
  canvas.style.height = __height + 'px';
  try {
    eval(contents);
  } catch(e) {
    render_error(e);
  }
  // Weird names to prevent collision with user code
  let __ctx = canvas.getContext("2d");
  let __iters = __num_frames;
  let __i = 0;
  if (__interval) {
      clearInterval(__interval);
  }
  let capture = false;
  if (capturer) {
    capture = true;
  }
  __interval = setInterval(function() {
    try {
      __ctx.clearRect(0, 0, canvas.width, canvas.height);
      __ctx.fillStyle = __background_color;
      __ctx.fillRect(0, 0, canvas.width, canvas.height);
      loop(__ctx, __i++);
      if (capture) {
        capturer.addFrame(__ctx, {copy:true, delay: 1000/__framerate});
        let info = document.getElementById('info');
        info.textContent = 'Recording... ' + Math.floor(100 * __i/__iters) + '%';
      }
    } catch(e) {
      clearInterval(__interval);
      render_error(e);
    }
    if (__i >= __iters) {
      if (capture) {
        capturer.render();
        capture = false;
      }
      __i = 0;
    }
  }, 1000 / __framerate);
}

function render() {
  render_impl(code_mirror.doc.getValue(),
    document.getElementById('note-output'));
}

function capture(button) {
  let capturer = new GIF({
    workerScript: '/static/gif.worker.js',
    workers: 4,
    quality: 1,
    height: __height,
    width: __width,
  });

  let info = document.getElementById('info');
  capturer.on('progress', function(p) {
    info.textContent = 'Rendering... ' + Math.floor(100 * p) + '%';
  });
  capturer.on('finished', function(blob) {
    let img = document.getElementById('output');
    img.src = URL.createObjectURL(blob);
    info.textContent = 'Right click to download'
  });

  render_impl(code_mirror.doc.getValue(),
    document.getElementById('note-output'),
    capturer);
}

function drawPoint(ctx, x, y, options={}) {
  let radius = options.radius || 2;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  ctx.stroke();
}

function drawFunction(ctx, f, x_min, x_max, options={}) {
  // Flip for clarity
  let func = (function(x) { return - f(x); }).bind({});
  ctx.beginPath();
  
  let y_offset = canvas.height - options.y_offset || canvas.height / 2;
  let x_offset = options.x_offset || canvas.width / 2;
  
  let y_scale = options.y_scale || 1;
  let x_scale = options.x_scale || 1;
  
  ctx.moveTo((x_offset + x_min) * x_scale, (y_offset + func(x_min) * y_scale));
  for (let x = x_min; x < x_max; ++x) {
    ctx.lineTo((x_offset + x * x_scale), (y_offset + func(x) * y_scale));
    ctx.moveTo((x_offset + x * x_scale), (y_offset + func(x) * y_scale));
  }
  ctx.stroke();

  return function(_x, _y) {
    return [x_offset + _x * x_scale, y_offset - _y * y_scale];
  }
}

window.addEventListener('load', function() {
  code_mirror = CodeMirror.fromTextArea(document.getElementById('note'),
    {
      mode:  "javascript",
      theme:  "zenburn",
    });

  let savedContents = localStorage.getItem("saved");
  if (savedContents) {
    code_mirror.doc.setValue(savedContents);
  }
  render();

  let timeout = null;
  code_mirror.on("change", function(){
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(function() {
      let contents = code_mirror.doc.getValue();
      localStorage.setItem("saved", contents);
      render();
      timeout = null;
    }, 500);
  });
});


