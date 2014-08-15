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
var helpers = require('../helpers');
var handlerCacheFromDir = helpers.handlerCacheFromDir;
var createStubHandler = helpers.createStubHandler;

var defaultOptions = {
  controllers: {},
  useStubs: false // Should we set this automatically based on process.env.NODE_ENV?
};

/**
 * Middleware for using Swagger information to route requests to handlers.
 *
 * This middleware also requires that you use the swagger-metadata middleware before this middleware.  This middleware
 * also makes no attempt to work around invalid Swagger documents.  If you would like to validate your requests using
 * the swagger-validator middleware, you must use it prior to using this middleware.
 *
 * The routing works such that any Swagger operation is expected to have a nickname like this:
 * {ControllerName}_{methodName}.  We will then identify the controller by name from the controllers path (configurable)
 * and identify the route handler within the controller by name.
 *
 * @param {object} [options] - The middleware options
 *
 * @returns the middleware function
 */
exports = module.exports = function swaggerRouterMiddleware (options) {
  var handlerCache = {};

  // Set the defaults
  options = _.defaults(options || {}, defaultOptions);

  if (_.isPlainObject(options.controllers)) {
    // Create the handler cache from the passed in controllers object
    _.each(options.controllers, function (func) {
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

    if (!_.isUndefined(operation)) {
      handler = handlerCache[operation.nickname];

      if (_.isUndefined(handler) && options.useStubs === true) {
        handler = handlerCache[operation.nickname] = createStubHandler(req, res,
                                                                       'Stubbed response for ' + operation.nickname);
      }

      if (!_.isUndefined(handler)) {
        return handler(req, res, next);
      }
    }

    return next();
  };
};