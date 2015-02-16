/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Apigee Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

'use strict';

var _ = require('lodash');
var cHelpers = require('../lib/helpers');
var debug = require('debug')('swagger-tools:middleware:router');
var fs = require('fs');
var mHelpers = require('./helpers');
var path = require('path');

var defaultOptions = {
  controllers: {},
  useStubs: false // Should we set this automatically based on process.env.NODE_ENV?
};
var getHandlerName = function getHandlerName (req) {
  var handlerName;

  switch (req.swagger.swaggerVersion) {
  case '1.2':
    handlerName = req.swagger.operation.nickname;
    break;

  case '2.0':
    handlerName = (req.swagger.operation['x-swagger-router-controller'] ?
      req.swagger.operation['x-swagger-router-controller'] :
      req.swagger.path['x-swagger-router-controller']) + '_' +
      (req.swagger.operation.operationId ? req.swagger.operation.operationId : req.method.toLowerCase());

    break;
  }

  return handlerName;
};
var handlerCacheFromDir = function handlerCacheFromDir (dirOrDirs) {
  var handlerCache = {};
  var jsFileRegex = /\.js|\.coffee$/;
  var dirs = [];

  if (_.isArray(dirOrDirs)) {
    dirs = dirOrDirs;
  } else {
    dirs.push(dirOrDirs);
  }

  debug('  Controllers:');

  _.each(dirs, function (dir) {
    _.each(fs.readdirSync(dir), function (file) {
      var controllerName = file.replace(jsFileRegex, '');
      var controller;

      if (file.match(jsFileRegex)) {
        controller = require(path.resolve(path.join(dir, controllerName)));

        debug('    %s%s:',
              path.resolve(path.join(dir, file)),
              (_.isPlainObject(controller) ? '' : ' (not an object, skipped)'));

        if (_.isPlainObject(controller)) {
          _.each(controller, function (value, name) {
            var handlerId = controllerName + '_' + name;

            debug('      %s%s',
                  handlerId,
                  (_.isFunction(value) ? '' : ' (not a function, skipped)'));

            // TODO: Log this situation

            if (_.isFunction(value) && !handlerCache[handlerId]) {
              handlerCache[handlerId] = value;
            }
          });
        }
      }
    });
  });

  return handlerCache;
};
var getMockValue = function getMockValue (version, schema) {
  var type = _.isPlainObject(schema) ? schema.type : schema;
  var value;

  if (!type) {
    type = 'object';
  }

  switch (type) {
  case 'array':
    value = [getMockValue(version, _.isArray(schema.items) ? schema.items[0] : schema.items)];

    break;

  case 'boolean':
    if (version === '1.2' && !_.isUndefined(schema.defaultValue)) {
      value = schema.defaultValue;
    } else if (version === '2.0' && !_.isUndefined(schema.default)) {
      value = schema.default;
    } else if (_.isArray(schema.enum)) {
      value = schema.enum[0];
    } else {
      value = 'true';
    }

    // Convert value if necessary
    value = value === 'true' || value === true ? true : false;

    break;

  case 'file':
  case 'File':
    value = 'Pretend this is some file content';

    break;

  case 'integer':
    if (version === '1.2' && !_.isUndefined(schema.defaultValue)) {
      value = schema.defaultValue;
    } else if (version === '2.0' && !_.isUndefined(schema.default)) {
      value = schema.default;
    } else if (_.isArray(schema.enum)) {
      value = schema.enum[0];
    } else {
      value = 1;
    }

    // Convert value if necessary
    if (!_.isNumber(value)) {
      value = parseInt(value, 10);
    }

    // TODO: Handle constraints and formats

    break;

  case 'object':
    value = {};

    _.each(schema.allOf, function (parentSchema) {
      _.each(parentSchema.properties, function (property, propName) {
        value[propName] = getMockValue(version, property);
      });
    });

    _.each(schema.properties, function (property, propName) {
      value[propName] = getMockValue(version, property);
    });

    break;

  case 'number':
    if (version === '1.2' && !_.isUndefined(schema.defaultValue)) {
      value = schema.defaultValue;
    } else if (version === '2.0' && !_.isUndefined(schema.default)) {
      value = schema.default;
    } else if (_.isArray(schema.enum)) {
      value = schema.enum[0];
    } else {
      value = 1.0;
    }

    // Convert value if necessary
    if (!_.isNumber(value)) {
      value = parseFloat(value);
    }

    // TODO: Handle constraints and formats

    break;

  case 'string':
    if (version === '1.2' && !_.isUndefined(schema.defaultValue)) {
      value = schema.defaultValue;
    } else if (version === '2.0' && !_.isUndefined(schema.default)) {
      value = schema.default;
    } else if (_.isArray(schema.enum)) {
      value = schema.enum[0];
    } else {
      value = 'Sample text';
    }

    // TODO: Handle constraints and formats

    break;
  }

  return value;
};
var mockResponse = function mockResponse (req, res, next, handlerName) {
  var method = req.method.toLowerCase();
  var operation = req.swagger.operation;
  var sendResponse = function sendResponse (err, response) {
    if (err) {
      return next(err);
    } else {
      return res.end(response);
    }
  };
  var spec = cHelpers.getSpec(req.swagger.swaggerVersion);
  var stubResponse = 'Stubbed response for ' + handlerName;
  var apiDOrSO;
  var responseType;

  switch (req.swagger.swaggerVersion) {
  case '1.2':
    apiDOrSO = req.swagger.apiDeclaration;
    responseType = operation.type;

    break;

  case '2.0':
    apiDOrSO = req.swagger.swaggerObject;

    if (method === 'post' && operation.responses['201']) {
      responseType = operation.responses['201'];

      res.statusCode = 201;
    } else if (method === 'delete' && operation.responses['204']) {
      responseType = operation.responses['204'];

      res.statusCode = 204;
    } else if (operation.responses['200']) {
      responseType = operation.responses['200'];
    } else if (operation.responses['default']) {
      responseType = operation.responses['default'];
    } else {
      responseType = 'void';
    }

    break;
  }

  if (_.isPlainObject(responseType) || mHelpers.isModelType(spec, responseType)) {
    if (req.swagger.swaggerVersion === '1.2') {
      spec.composeModel(apiDOrSO, responseType, function (err, result) {
        if (err) {
          return sendResponse(undefined, err);
        } else {
          // Should we handle this differently as undefined typically means the model doesn't exist
          return sendResponse(undefined, _.isUndefined(result) ?
                                           stubResponse :
                                           JSON.stringify(getMockValue(req.swagger.swaggerVersion, result)));
        }
      });
    } else {
      return sendResponse(undefined, JSON.stringify(getMockValue(req.swagger.swaggerVersion, responseType.schema ?
                                                                            responseType.schema :
                                                                            responseType)));
    }
  } else {
    return sendResponse(undefined, getMockValue(req.swagger.swaggerVersion, responseType));
  }
};
var createStubHandler = function createStubHandler (req, res, next, handlerName) {
  // TODO: Handle headers for 2.0
  // TODO: Handle examples (per mime-type) for 2.0
  // TODO: Handle non-JSON response types

  return function stubHandler () {
    mockResponse(req, res, next, handlerName);
  };
};
var send405 = function send405 (req, res, next) {
  var allowedMethods = [];
  var err = new Error('Route defined in Swagger specification (' +
                        (_.isUndefined(req.swagger.api) ? req.swagger.apiPath : req.swagger.api.path) +
                        ') but there is no defined ' +
                      (req.swagger.swaggerVersion === '1.2' ? req.method.toUpperCase() : req.method.toLowerCase()) + ' operation.');

  if (!_.isUndefined(req.swagger.api)) {
    _.each(req.swagger.api.operations, function (operation) {
      allowedMethods.push(operation.method.toUpperCase());
    });
  } else {
    _.each(req.swagger.path, function (operation, method) {
      if (cHelpers.swaggerOperationMethods.indexOf(method.toUpperCase()) !== -1) {
        allowedMethods.push(method.toUpperCase());
      }
    });
  }

  err.allowedMethods = allowedMethods;

  res.setHeader('Allow', allowedMethods.sort().join(', '));
  res.statusCode = 405;

  return next(err);
};

/**
 * Middleware for using Swagger information to route requests to handlers.  Due to the differences between Swagger 1.2
 * and Swagger 2.0, the way in which your Swagger document(s) are annotated to work with this middleware differs as well
 * so please view the documentation below for more details:
 *
 *     https://github.com/apigee-127/swagger-tools/blob/master/docs/Middleware.md#swaggerrouteroptions
 *
 * This middleware also requires that you use the swagger-metadata middleware before this middleware.  This middleware
 * also makes no attempt to work around invalid Swagger documents.  If you would like to validate your requests using
 * the swagger-validator middleware, you must use it prior to using this middleware.
 *
 * @param {object} [options] - The middleware options
 * @param {(string|object|string[]} [options.controllers=./controllers] - If this is a string or string array, this is
 *                                                                        the path, or paths, to find the controllers
 *                                                                        in.  If it's an object, the keys are the
 *                                                                        controller "name" (as described above) and the
 *                                                                        value is a function.
 * @param {boolean} [options.useStubs=false] - Whether or not to stub missing controllers and methods
 *
 * @returns the middleware function
 */
exports = module.exports = function swaggerRouterMiddleware (options) {
  var handlerCache = {};

  debug('Initializing swagger-metadata middleware');

  // Set the defaults
  options = _.defaults(options || {}, defaultOptions);

  debug('  Mock mode: %s', options.useStubs === true ? 'enabled' : 'disabled');

  if (_.isPlainObject(options.controllers)) {
    debug('  Controllers:');

    // Create the handler cache from the passed in controllers object
    _.each(options.controllers, function (func, handlerName) {
      debug('    %s', handlerName);

      if (!_.isFunction(func)) {
        throw new Error('options.controllers values must be functions');
      }
    });

    handlerCache = options.controllers;
  } else {
    // Create the handler cache from the modules in the controllers directory
    handlerCache = handlerCacheFromDir(options.controllers);
  }

  return function swaggerRouter (req, res, next) {
    var operation = req.swagger ? req.swagger.operation : undefined;
    var handler;
    var handlerName;
    var rErr;

    debug('%s %s', req.method, req.url);
    debug('  Will process: %s', _.isUndefined(operation) ? 'no' : 'yes');

    if (req.swagger) {
      if (operation) {
        handlerName = getHandlerName(req);
        handler = handlerCache[handlerName];

        req.swagger.useStubs = options.useStubs;

        debug('  Route handler: %s', (_.isUndefined(handler) ? 'false' : handlerName));
        debug('  Mock mode: %s', options.useStubs);

        if (_.isUndefined(handler) && options.useStubs === true) {
          handler = handlerCache[handlerName] = createStubHandler(req, res, next, handlerName);
        }

        if (!_.isUndefined(handler)) {
          try {
            return handler(req, res, next);
          } catch (err) {
            rErr = err;

            debug('Handler threw an unexpected error: %s\n%s', err.message, err.stack);
          }
        }
      } else {
        debug('  No handler for method: %s', req.method);

        return send405(req, res, next);
      }
    }

    if (rErr) {
      mHelpers.debugError(rErr, debug);
    }

    return next(rErr);
  };
};