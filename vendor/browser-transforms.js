/**
 * Copyright 2013-2014 Facebook, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* jshint browser: true */
/* jslint evil: true */

'use strict';
var runScripts;
var loadScripts;
var headEl;

var buffer = require('buffer');
var transform = require('jstransform').transform;
var visitors = require('./fbtransform/visitors');
var docblock = require('jstransform/src/docblock');

// The source-map library relies on Object.defineProperty, but IE8 doesn't
// support it fully even with es5-sham. Indeed, es5-sham's defineProperty
// throws when Object.prototype.__defineGetter__ is missing, so we skip building
// the source map in that case.
var supportsAccessors = Object.prototype.hasOwnProperty('__defineGetter__');

function transformReact(source, options) {
  var visitorList;
  if (options && options.harmony) {
    visitorList = visitors.getAllVisitors();
  } else {
    visitorList = visitors.transformVisitors.react;
  }

  return transform(visitorList, source, {
    sourceMap: supportsAccessors
  });
}

exports.transform = transformReact;

exports.exec = function(code, options) {
  return eval(transformReact(code, options).code);
};

var inlineScriptCount = 0;

// This method returns a nicely formated line of code pointing the
// exactly location of the error `e`.
// The line is limited in size so big lines of code are also shown
// in a readable way.
// Example:
//
// ... x', overflow:'scroll'}} id={} onScroll={this.scroll} class=" ...
//                                 ^
var createSourceCodeErrorMessage = function(code, e) {
  var sourceLines = code.split('\n');
  var erroneousLine = sourceLines[e.lineNumber - 1];

  // Removes any leading indenting spaces and gets the number of
  // chars indenting the `erroneousLine`
  var indentation = 0;
  erroneousLine = erroneousLine.replace(/^\s+/, function(leadingSpaces) {
    indentation = leadingSpaces.length;
    return '';
  });

  // Defines the number of characters that are going to show
  // before and after the erroneous code
  var LIMIT = 30;
  var errorColumn = e.column - indentation;

  if (errorColumn > LIMIT) {
    erroneousLine = '... ' + erroneousLine.slice(errorColumn - LIMIT);
    errorColumn = 4 + LIMIT;
  }
  if (erroneousLine.length - errorColumn > LIMIT) {
    erroneousLine = erroneousLine.slice(0, errorColumn + LIMIT) + ' ...';
  }
  var message = '\n\n' + erroneousLine + '\n';
  message += new Array(errorColumn - 1).join(' ') + '^';
  return message;
};

var transformCode = function(code, source) {
  var jsx = docblock.parseAsObject(docblock.extract(code)).jsx;

  if (jsx) {
    try {
      var transformed = transformReact(code);
    } catch(e) {
      e.message += '\n    at ';
      if (source) {
        if ('fileName' in e) {
          // We set `fileName` if it's supported by this error object and
          // a `source` was provided.
          // The error will correctly point to `source` in Firefox.
          e.fileName = source;
        }
        e.message += source + ':' + e.lineNumber + ':' + e.column;
      } else {
        e.message += location.href;
      }
      e.message += createSourceCodeErrorMessage(code, e);
      throw e;
    }

    if (!transformed.sourceMap) {
      return transformed.code;
    }

    var map = transformed.sourceMap.toJSON();
    if (source == null) {
      source = "Inline JSX script";
      inlineScriptCount++;
      if (inlineScriptCount > 1) {
        source += ' (' + inlineScriptCount + ')';
      }
    }
    map.sources = [source];
    map.sourcesContent = [code];

    return (
      transformed.code +
      '//# sourceMappingURL=data:application/json;base64,' +
      buffer.Buffer(JSON.stringify(map)).toString('base64')
    );
  } else {
    return code;
  }
};

var run = exports.run = function(code, source) {
  var scriptEl = document.createElement('script');
  scriptEl.text = transformCode(code, source);
  headEl.appendChild(scriptEl);
};

var load = exports.load = function(url, callback) {
  var xhr;
  xhr = window.ActiveXObject ? new window.ActiveXObject('Microsoft.XMLHTTP')
                             : new XMLHttpRequest();

  // async, however scripts will be executed in the order they are in the
  // DOM to mirror normal script loading.
  xhr.open('GET', url, true);
  if ('overrideMimeType' in xhr) {
    xhr.overrideMimeType('text/plain');
  }
  xhr.onreadystatechange = function() {
    if (xhr.readyState === 4) {
      if (xhr.status === 0 || xhr.status === 200) {
        callback(xhr.responseText, url);
      } else {
        throw new Error("Could not load " + url);
      }
    }
  };
  return xhr.send(null);
};

loadScripts = function(scripts) {
  var result = scripts.map(function() {
    return false;
  });
  var count = result.length;

  var check = function() {
    var script, i;

    for (i = 0; i < count; i++) {
      script = result[i];

      if (script && !script.executed) {
        run(script.content, script.url);
        script.executed = true;
      } else if (!script) {
        break;
      }
    };
  };

  scripts.forEach(function(script, i) {
    if (script.src) {
      load(script.src, function(content, url) {
        result[i] = { executed: false, content: content, url: url };
        check();
      });
    } else {
      result[i] = { executed: false, content: script.innerHTML, url: null };
      check();
    }
  });
};

runScripts = function() {
  var scripts = document.getElementsByTagName('script');

  // Array.prototype.slice cannot be used on NodeList on IE8
  var jsxScripts = [];
  for (var i = 0; i < scripts.length; i++) {
    if (scripts.item(i).type === 'text/jsx') {
      jsxScripts.push(scripts.item(i));
    }
  }

  console.warn("You are using the in-browser JSX transformer. Be sure to precompile your JSX for production - http://facebook.github.io/react/docs/tooling-integration.html#jsx");

  loadScripts(jsxScripts);
};

if (typeof window !== "undefined" && window !== null) {
  headEl = document.getElementsByTagName('head')[0];

  if (window.addEventListener) {
    window.addEventListener('DOMContentLoaded', runScripts, false);
  } else {
    window.attachEvent('onload', runScripts);
  }
}
