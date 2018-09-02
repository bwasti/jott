"use strict";
function moo_factory() {
  'use strict';

  var hasOwnProperty = Object.prototype.hasOwnProperty
  var toString = Object.prototype.toString
  var hasSticky = typeof new RegExp().sticky === 'boolean'

  /***************************************************************************/

  function isRegExp(o) { return o && toString.call(o) === '[object RegExp]' }
  function isObject(o) { return o && typeof o === 'object' && !isRegExp(o) && !Array.isArray(o) }

  function reEscape(s) {
    return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
  }
  function reGroups(s) {
    var re = new RegExp('|' + s)
    return re.exec('').length - 1
  }
  function reCapture(s) {
    return '(' + s + ')'
  }
  function reUnion(regexps) {
    if (!regexps.length) return '(?!)'
    var source =  regexps.map(function(s) {
      return "(?:" + s + ")"
    }).join('|')
    return "(?:" + source + ")"
  }

  function regexpOrLiteral(obj) {
    if (typeof obj === 'string') {
      return '(?:' + reEscape(obj) + ')'

    } else if (isRegExp(obj)) {
      // TODO: consider /u support
      if (obj.ignoreCase) throw new Error('RegExp /i flag not allowed')
      if (obj.global) throw new Error('RegExp /g flag is implied')
      if (obj.sticky) throw new Error('RegExp /y flag is implied')
      if (obj.multiline) throw new Error('RegExp /m flag is implied')
      if (obj.unicode) throw new Error('RegExp /u flag is not allowed')
      return obj.source

    } else {
      throw new Error('Not a pattern: ' + obj)
    }
  }

  function objectToRules(object) {
    var keys = Object.getOwnPropertyNames(object)
    var result = []
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]
      var thing = object[key]
      var rules = Array.isArray(thing) ? thing : [thing]
      var match = []
      rules.forEach(function(rule) {
        if (isObject(rule)) {
          if (match.length) result.push(ruleOptions(key, match))
          result.push(ruleOptions(key, rule))
          match = []
        } else {
          match.push(rule)
        }
      })
      if (match.length) result.push(ruleOptions(key, match))
    }
    return result
  }

  function arrayToRules(array) {
    var result = []
    for (var i = 0; i < array.length; i++) {
      var obj = array[i]
      if (!obj.name) {
        throw new Error('Rule has no name: ' + JSON.stringify(obj))
      }
      result.push(ruleOptions(obj.name, obj))
    }
    return result
  }

  function ruleOptions(name, obj) {
    if (!isObject(obj)) {
      obj = { match: obj }
    }

    // nb. error and fallback imply lineBreaks
    var options = {
      tokenType: name,
      lineBreaks: !!obj.error || !!obj.fallback,
      pop: false,
      next: null,
      push: null,
      error: false,
      fallback: false,
      value: null,
      getType: null,
      shouldThrow: false,
    }

    // Avoid Object.assign(), so we support IE9+
    for (var key in obj) {
      if (hasOwnProperty.call(obj, key)) {
        options[key] = obj[key]
      }
    }

    // convert to array
    var match = options.match
    options.match = Array.isArray(match) ? match : match ? [match] : []
    options.match.sort(function(a, b) {
      return isRegExp(a) && isRegExp(b) ? 0
           : isRegExp(b) ? -1 : isRegExp(a) ? +1 : b.length - a.length
    })
    if (options.keywords) {
      options.getType = keywordTransform(options.keywords)
    }
    return options
  }

  var defaultErrorRule = ruleOptions('error', {lineBreaks: true, shouldThrow: true})
  function compileRules(rules, hasStates) {
    rules = Array.isArray(rules) ? arrayToRules(rules) : objectToRules(rules)

    var errorRule = null
    var fast = Object.create(null)
    var fastAllowed = true
    var groups = []
    var parts = []
    for (var i = 0; i < rules.length; i++) {
      var options = rules[i]

      if (options.error || options.fallback) {
        // errorRule can only be set once
        if (errorRule) {
          if (!options.fallback === !errorRule.fallback) {
            throw new Error("Multiple " + (options.fallback ? "fallback" : "error") + " rules not allowed (for token '" + options.tokenType + "')")
          } else {
            throw new Error("fallback and error are mutually exclusive (for token '" + options.tokenType + "')")
          }
        }
        errorRule = options
      }

      var match = options.match
      if (fastAllowed) {
        while (match.length && typeof match[0] === 'string' && match[0].length === 1) {
          var word = match.shift()
          fast[word.charCodeAt(0)] = options
        }
      }

      // Warn about inappropriate state-switching options
      if (options.pop || options.push || options.next) {
        if (!hasStates) {
          throw new Error("State-switching options are not allowed in stateless lexers (for token '" + options.tokenType + "')")
        }
        if (options.fallback) {
          throw new Error("State-switching options are not allowed on fallback tokens (for token '" + options.tokenType + "')")
        }
      }

      // Only rules with a .match are included in the RegExp
      if (match.length === 0) {
        continue
      }
      fastAllowed = false

      groups.push(options)

      // convert to RegExp
      var pat = reUnion(match.map(regexpOrLiteral))

      // validate
      var regexp = new RegExp(pat)
      if (regexp.test("")) {
        throw new Error("RegExp matches empty string: " + regexp)
      }
      var groupCount = reGroups(pat)
      if (groupCount > 0) {
        throw new Error("RegExp has capture groups: " + regexp + "\nUse (?: … ) instead")
      }

      // try and detect rules matching newlines
      if (!options.lineBreaks && regexp.test('\n')) {
        throw new Error('Rule should declare lineBreaks: ' + regexp)
      }

      // store regex
      parts.push(reCapture(pat))
    }


    // If there's no fallback rule, use the sticky flag so we only look for
    // matches at the current index.
    //
    // If we don't support the sticky flag, then fake it using an irrefutable
    // match (i.e. an empty pattern).
    var fallbackRule = errorRule && errorRule.fallback
    var flags = hasSticky && !fallbackRule ? 'ym' : 'gm'
    var suffix = hasSticky || fallbackRule ? '' : '|'
    var combined = new RegExp(reUnion(parts) + suffix, flags)

    return {regexp: combined, groups: groups, fast: fast, error: errorRule || defaultErrorRule}
  }

  function compile(rules) {
    var result = compileRules(rules)
    return new Lexer({start: result}, 'start')
  }

  function checkStateGroup(g, name, map) {
    var state = g && (g.push || g.next)
    if (state && !map[state]) {
      throw new Error("Missing state '" + state + "' (in token '" + g.tokenType + "' of state '" + name + "')")
    }
    if (g && g.pop && +g.pop !== 1) {
      throw new Error("pop must be 1 (in token '" + g.tokenType + "' of state '" + name + "')")
    }
  }
  function compileStates(states, start) {
    var keys = Object.getOwnPropertyNames(states)
    if (!start) start = keys[0]

    var map = Object.create(null)
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i]
      map[key] = compileRules(states[key], true)
    }

    for (var i = 0; i < keys.length; i++) {
      var name = keys[i]
      var state = map[name]
      var groups = state.groups
      for (var j = 0; j < groups.length; j++) {
        checkStateGroup(groups[j], name, map)
      }
      var keys = Object.getOwnPropertyNames(state.fast)
      for (var j = 0; j < keys.length; j++) {
        checkStateGroup(state.fast[keys[j]], name, map)
      }
    }

    return new Lexer(map, start)
  }

  function keywordTransform(map) {
    var reverseMap = Object.create(null)
    var byLength = Object.create(null)
    var types = Object.getOwnPropertyNames(map)
    for (var i = 0; i < types.length; i++) {
      var tokenType = types[i]
      var item = map[tokenType]
      var keywordList = Array.isArray(item) ? item : [item]
      keywordList.forEach(function(keyword) {
        (byLength[keyword.length] = byLength[keyword.length] || []).push(keyword)
        if (typeof keyword !== 'string') {
          throw new Error("keyword must be string (in keyword '" + tokenType + "')")
        }
        reverseMap[keyword] = tokenType
      })
    }

    // fast string lookup
    // https://jsperf.com/string-lookups
    function str(x) { return JSON.stringify(x) }
    var source = ''
    source += 'switch (value.length) {\n'
    for (var length in byLength) {
      var keywords = byLength[length]
      source += 'case ' + length + ':\n'
      source += 'switch (value) {\n'
      keywords.forEach(function(keyword) {
        var tokenType = reverseMap[keyword]
        source += 'case ' + str(keyword) + ': return ' + str(tokenType) + '\n'
      })
      source += '}\n'
    }
    source += '}\n'
    return Function('value', source) // getType
  }

  /***************************************************************************/

  var Lexer = function(states, state) {
    this.startState = state
    this.states = states
    this.buffer = ''
    this.stack = []
    this.reset()
  }

  Lexer.prototype.reset = function(data, info) {
    this.buffer = data || ''
    this.index = 0
    this.line = info ? info.line : 1
    this.col = info ? info.col : 1
    this.queuedToken = info ? info.queuedToken : null
    this.queuedThrow = info ? info.queuedThrow : null
    this.setState(info ? info.state : this.startState)
    return this
  }

  Lexer.prototype.save = function() {
    return {
      line: this.line,
      col: this.col,
      state: this.state,
      queuedToken: this.queuedToken,
      queuedThrow: this.queuedThrow,
    }
  }

  Lexer.prototype.setState = function(state) {
    if (!state || this.state === state) return
    this.state = state
    var info = this.states[state]
    this.groups = info.groups
    this.error = info.error
    this.re = info.regexp
    this.fast = info.fast
  }

  Lexer.prototype.popState = function() {
    this.setState(this.stack.pop())
  }

  Lexer.prototype.pushState = function(state) {
    this.stack.push(this.state)
    this.setState(state)
  }

  Lexer.prototype._eat = hasSticky ? function(re) { // assume re is /y
    return re.exec(this.buffer)
  } : function(re) { // assume re is /g
    var match = re.exec(this.buffer)
    // will always match, since we used the |(?:) trick
    if (match[0].length === 0) {
      return null
    }
    return match
  }

  Lexer.prototype._getGroup = function(match) {
    if (match === null) {
      return -1
    }

    var groupCount = this.groups.length
    for (var i = 0; i < groupCount; i++) {
      if (match[i + 1] !== undefined) {
        return i
      }
    }
    throw new Error('Cannot find token type for matched text')
  }

  function tokenToString() {
    return this.value
  }

  Lexer.prototype.next = function() {
    if (this.queuedToken) {
      var queuedToken = this.queuedToken, queuedThrow = this.queuedThrow
      this.queuedToken = null
      this.queuedThrow = false
      if (queuedThrow) {
        throw new Error(this.formatError(queuedToken, "invalid syntax"))
      }
      return queuedToken
    }
    var re = this.re
    var buffer = this.buffer

    var index = re.lastIndex = this.index
    if (index === buffer.length) {
      return // EOF
    }

    var group, text, matchIndex
    group = this.fast[buffer.charCodeAt(index)]
    if (group) {
      text = buffer.charAt(index)
      matchIndex = index

    } else {
      var match = this._eat(re)
      matchIndex = match ? match.index : this.buffer.length
      var i = this._getGroup(match)

      if ((this.error.fallback && matchIndex !== index) || i === -1) {
        var fallbackToken = this._hadToken(this.error, buffer.slice(index, matchIndex), index)

        if (i === -1) {
          if (this.error.shouldThrow) {
            throw new Error(this.formatError(fallbackToken, "invalid syntax"))
          }
          return fallbackToken
        }
      }

      group = this.groups[i]
      text = match[0]
    }
    var token = this._hadToken(group, text, matchIndex)

    // throw, if no rule with {error: true}
    if (fallbackToken) {
      this.queuedToken = token
      this.queuedThrow = group.shouldThrow
    } else if (group.shouldThrow) {
      throw new Error(this.formatError(token, "invalid syntax"))
    }

    if (group.pop) this.popState()
    else if (group.push) this.pushState(group.push)
    else if (group.next) this.setState(group.next)

    return fallbackToken || token
  }

  Lexer.prototype._hadToken = function(group, text, offset) {
    // count line breaks
    var lineBreaks = 0
    if (group.lineBreaks) {
      var matchNL = /\n/g
      var nl = 1
      if (text === '\n') {
        lineBreaks = 1
      } else {
        while (matchNL.exec(text)) { lineBreaks++; nl = matchNL.lastIndex }
      }
    }

    var token = {
      type: (group.getType && group.getType(text)) || group.tokenType,
      value: group.value ? group.value(text) : text,
      text: text,
      toString: tokenToString,
      offset: offset,
      lineBreaks: lineBreaks,
      line: this.line,
      col: this.col,
    }
    // nb. adding more props to token object will make V8 sad!

    var size = text.length
    this.index += size
    this.line += lineBreaks
    if (lineBreaks !== 0) {
      this.col = size - nl + 1
    } else {
      this.col += size
    }
    return token
  }

  if (typeof Symbol !== 'undefined' && Symbol.iterator) {
    var LexerIterator = function(lexer) {
      this.lexer = lexer
    }

    LexerIterator.prototype.next = function() {
      var token = this.lexer.next()
      return {value: token, done: !token}
    }

    LexerIterator.prototype[Symbol.iterator] = function() {
      return this
    }

    Lexer.prototype[Symbol.iterator] = function() {
      return new LexerIterator(this)
    }
  }

  Lexer.prototype.formatError = function(token, message) {
    var value = token.value
    var index = token.offset
    var eol = token.lineBreaks ? value.indexOf('\n') : value.length
    var start = Math.max(0, index - token.col + 1)
    var firstLine = this.buffer.substring(start, index + eol)
    message += " at line " + token.line + " col " + token.col + ":\n\n"
    message += "  " + firstLine + "\n"
    message += "  " + Array(token.col).join(" ") + "^"
    return message
  }

  Lexer.prototype.clone = function() {
    return new Lexer(this.states, this.state)
  }

  Lexer.prototype.has = function(tokenType) {
    for (var s in this.states) {
      var state = this.states[s]
      if (state.error && state.error.tokenType === tokenType) return true
      var groups = state.groups
      for (var i = 0; i < groups.length; i++) {
        var group = groups[i]
        if (group.tokenType === tokenType) return true
        if (group.keywords && hasOwnProperty.call(group.keywords, tokenType)) {
          return true
        }
      }
    }
    return false
  }


  return {
    compile: compile,
    states: compileStates,
    error: Object.freeze({error: true}),
    fallback: Object.freeze({fallback: true}),
  }

}
const moo = moo_factory();
const tokens = {
    h6: /^###### /,
    h5: /^##### /,
    h4: /^#### /,
    h3: /^### /,
    h2: /^## /,
    h1: /^# /,
    esc: /\*\*|\/\/|__/,
    b: '*',
    i: '/',
    u: '_',
    uli: /^[ ]*\- /,
    oli: /^[ ]*\d+\. /,
    a: /\[[^\]\n]*\]\([^)\n]*\)/,
    img: /!\[[^\]\n]*\]\([^)\n]*\)/,
    $$: /^\$\$$(?:\\\$|[^$])+^\$\$$/,
    $: /\$(?:\\\$|[^\n$])+\$/,
    tikz: /^\\begin\{tikzpicture\}[^]*?^\\end\{tikzpicture\}/,
    cmd: /^\\\w+\{[^}]*\}$/,
    env: /^\\\w+$/,
    hr: /^--$/,
    txt: /[^/!\n*_$\\\[\]]+|[!*_$\\/\[\]]/,
    blank: { match: /^\n/, lineBreaks: true },
    eol: { match: /\n/, lineBreaks: true }
};
function texDown(src, ...renderers) {
    const lexer = moo.compile(tokens);
    lexer.reset(src.replace(/\r/g, ''));
    let id = 0;
    let currentToken;
    const stack = [];
    const env = {};
    const topElement = () => stack[stack.length - 1];
    const popElement = () => {
        const el = stack.pop();
        renderers.forEach(r => r.endElement(el));
    };
    const endEnv = (name) => {
        env[name] = false;
        renderers.forEach(r => r.endEnv(name));
    };
    const clearElements = () => {
        while (stack.length)
            popElement();
    };
    const clearEnvs = () => {
        renderers.forEach(r => {
            Object.entries(env).forEach(([name, b]) => {
                if (b)
                    r.endEnv(name);
            });
        });
    };
    const pushElement = (el) => {
        stack.push(el);
        renderers.forEach(r => r.startElement(el, id));
        return el;
    };
    const startEnv = (e) => {
        env[e] = true;
        renderers.forEach(r => r.startEnv(e));
    };
    const h = (type) => {
        clearElements();
        pushElement({
            type: type,
            token: currentToken.text
        });
    };
    const format = (type) => {
        if (stack.length && topElement().type === type) {
            popElement();
            return;
        }
        if (!stack.length)
            pushElement({
                type: 'p',
                token: ''
            });
        pushElement({
            type: type,
            token: currentToken.text
        });
    };
    const li = (type) => {
        const nestLevel = currentToken.text.replace(/\d+/, '').length;
        const matchingList = () => {
            const te = topElement();
            return te
                && ['ul', 'ol'].includes(te.type)
                && te.data <= nestLevel;
        };
        while (stack.length && !matchingList()) {
            popElement();
        }
        const te = topElement();
        if (!te || te.type !== type || te.data < nestLevel) {
            pushElement({
                type: type,
                token: '',
                data: nestLevel
            });
        }
        pushElement({
            type: 'li',
            token: currentToken.text
        });
    };
    const reLink = /!?\[([^\]]*)\]\(([^)]*)\)/;
    const extractLink = (link) => {
        const res = reLink.exec(link);
        return [res[1], res[2]];
    };
    const reCmd = /\\(\w+)\{([^}]*)\}/;
    const extractCmd = (cmd) => {
        const res = reCmd.exec(cmd);
        return [res[1], res[2]];
    };
    const pushParIfEmpty = () => {
        if (!stack.length)
            pushElement({
                type: 'p',
                token: ''
            });
    };
    const actions = {
        h6: () => h('h6'),
        h5: () => h('h5'),
        h4: () => h('h4'),
        h3: () => h('h3'),
        h2: () => h('h2'),
        h1: () => h('h1'),
        b: () => format('b'),
        i: () => format('i'),
        u: () => format('u'),
        uli: () => li('ul'),
        oli: () => li('ol'),
        a: () => {
            pushParIfEmpty();
            const [title, href] = extractLink(currentToken.text);
            renderers.forEach(r => r.a(title, href, id));
        },
        img: () => {
            pushParIfEmpty();
            const [title, href] = extractLink(currentToken.text);
            renderers.forEach(r => r.img(title, href, id));
        },
        $$: () => {
            clearElements();
            const txt = currentToken.text;
            const tex = txt.substring(2, txt.length - 2);
            renderers.forEach(r => r.$$(tex, id));
        },
        $: () => {
            pushParIfEmpty();
            const txt = currentToken.text;
            const tex = txt.substring(1, txt.length - 1);
            renderers.forEach(r => r.$(tex, id));
        },
        env: () => {
            clearElements();
            const e = currentToken.text.substr(1);
            if (env[e])
                endEnv(e);
            else
                startEnv(e);
        },
        cmd: () => {
            clearElements();
            const [name, arg] = extractCmd(currentToken.text);
            renderers.forEach(r => {
                r.cmd(name, arg);
            });
        },
        tikz: () => {
            clearElements();
            renderers.forEach(r => r.tikz(currentToken.text, id));
        },
        hr: () => {
            clearElements();
            renderers.forEach(r => r.hr());
        },
        esc: () => {
            renderers.forEach(r => r.esc(currentToken.text));
        },
        txt: () => {
            pushParIfEmpty();
            renderers.forEach(r => r.txt(currentToken.text));
        },
        blank: () => {
            clearElements();
            renderers.forEach(r => r.blank());
        },
        eol: () => {
            const multiline = ['p', 'li'];
            while (stack.length
                && !multiline.includes(topElement().type))
                popElement();
            const te = topElement();
            if (te && multiline.includes(te.type)) {
                renderers.forEach(r => r.eol());
            }
        }
    };
    while (true) {
        id++;
        currentToken = lexer.next();
        if (currentToken === undefined)
            break;
        actions[currentToken.type]();
    }
    clearElements();
    clearEnvs();
    renderers.forEach(r => r.done());
}

class Renderer {
  constructor() {
    this.res = ''; 
    this.startEnv = (name) => {
      this.res += `<div class='${name}'>`;
    };  
    this.endEnv = (name) => {
      this.res += `</div>`;
    };  
    this.cmd = (name, arg) => {
      this.res += `\\${name}\{${arg}\}`;
    };  
    this.hr = () => this.res += '<hr />';
    this.startElement = (el) => {
      this.res += `<${el.type}>`;
    };  
    this.endElement = (el) => {
      this.res += `</${el.type}>`;
    };  
    this.$$ = (tex) => this.res += `<span>$$ ${tex} $$</span>`;
    this.$ = (tex) => this.res += `<span>$ ${tex} $</span>`;
    this.a = (title, href) => this.res += `<a href='${href}'>${title || href}</a>`;
    this.img = (title, src) => this.res += `<img title='${title}' src='${src}' />`;
    this.esc = (val) => this.res += val[0];
    this.txt = (val) => this.res += val;
    this.tikz = (tikz) => this.res += `<tikz>${tikz}</tikz>`;
    this.eol = () => { };
    this.blank = () => { };
    this.done = () => { };
  }   
}

