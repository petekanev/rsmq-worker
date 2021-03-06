(function() {
  var RSMQ, RSMQWorker, _delay, _isArray, _isBoolean, _isFunction, _isNumber, _last, _once, async,
    bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty,
    slice = [].slice;

  _isFunction = require("lodash/isFunction");

  _once = require("lodash/once");

  _isBoolean = require("lodash/isBoolean");

  _isNumber = require("lodash/isNumber");

  _isArray = require("lodash/isArray");

  _last = require("lodash/last");

  _delay = require("lodash/delay");

  async = require("async");

  RSMQ = require("rsmq");

  RSMQWorker = (function(superClass) {
    extend(RSMQWorker, superClass);

    RSMQWorker.prototype.stopped = false;

    RSMQWorker.prototype.defaults = function() {
      return this.extend(RSMQWorker.__super__.defaults.apply(this, arguments), {
        interval: [0, 1, 5, 10],
        maxReceiveCount: 10,
        invisibletime: 30,
        defaultDelay: 1,
        autostart: false,
        customExceedCheck: null,
        timeout: 3000,
        alwaysLogErrors: false,
        rsmq: null,
        redis: null,
        redisPrefix: "rsmq",
        host: "localhost",
        port: 6379,
        options: {}
      });
    };


    /*
    	## constructor
     */

    function RSMQWorker(queuename, options) {
      this.queuename = queuename;
      if (options == null) {
        options = {};
      }
      this.next = bind(this.next, this);
      this.interval = bind(this.interval, this);
      this.check = bind(this.check, this);
      this.receive = bind(this.receive, this);
      this._runOfflineMessages = bind(this._runOfflineMessages, this);
      this._send = bind(this._send, this);
      this._initQueue = bind(this._initQueue, this);
      this._getRsmq = bind(this._getRsmq, this);
      this._onReConnect = bind(this._onReConnect, this);
      this._onDisconnect = bind(this._onDisconnect, this);
      this._initRSMQ = bind(this._initRSMQ, this);
      this.size = bind(this.size, this);
      this.info = bind(this.info, this);
      this.changeInterval = bind(this.changeInterval, this);
      this.del = bind(this.del, this);
      this.send = bind(this.send, this);
      this.quit = bind(this.quit, this);
      this.stop = bind(this.stop, this);
      this.start = bind(this.start, this);
      this.defaults = bind(this.defaults, this);
      RSMQWorker.__super__.constructor.call(this, options);
      if ((options.interval != null) && _isArray(options.interval)) {
        this.config.interval = options.interval;
      }
      this.ready = false;
      this.waitCount = 0;
      this.on("next", this.next);
      this.on("data", this.check);
      this.offlineQueue = [];
      this._initRSMQ();
      if (this.config.autostart) {
        this.on("ready", this.start);
      }
      this.debug("config", this.config);
      return;
    }


    /*
    	## start
    
    	`RSMQWorker.start()`
    
    	Start the worker
    
    	@return { RedisSMQ } A rsmq instance
    
    	@return { RSMQWorker } The instance itself for chaining.
    
    	@api public
     */

    RSMQWorker.prototype.start = function() {
      var ref;
      if (this.ready) {
        if (((ref = this.queue.listeners('disconnect')) != null ? ref.indexOf(this._onDisconnect) : void 0) < 0) {
          this.queue.on("disconnect", this._onDisconnect);
        }
        this.stopped = false;
        this.interval();
        return;
      }
      this.on("ready", this.start);
      return this;
    };


    /*
    	## stop
    
    	`RSMQWorker.stop()`
    
    	Stop the worker receiving messages
    
    	@return { RSMQWorker } The instance itself for chaining.
    
    	@api public
     */

    RSMQWorker.prototype.stop = function() {
      if (!this.stopped) {
        this.stopped = true;
        this.queue.removeListener("disconnect", this._onDisconnect);
        if (this.timeout != null) {
          clearTimeout(this.timeout);
        }
        this.emit("stopped");
      }
      return this;
    };


    /*
    	## quit
    
    	`RSMQWorker.quit()`
    
    	Stop the worker and quit the connection
    
    	@api public
     */

    RSMQWorker.prototype.quit = function() {
      this.stop();
      if (this.queue != null) {
        this.queue.quit();
        this.queue = null;
      }
    };


    /*
    	## send
    
    	`RSMQWorker.send( msg [, delay] )`
    
    	Helper/Convinience method to send a new message to the queue.
    
    	@param { String } msg The message content
    	@param { Number } [delay=0] The message delay to hide this message for the next `x` seconds.
    	@param { Function } [cb] A optional callback to get a secure response for a successful send.
    
    	@return { RSMQWorker } The instance itself for chaining.
    
    	@api public
     */

    RSMQWorker.prototype.send = function() {
      var args, cb, delay, msg;
      msg = arguments[0], args = 2 <= arguments.length ? slice.call(arguments, 1) : [];
      delay = args[0], cb = args[1];
      if (_isFunction(delay)) {
        cb = delay;
        delay = null;
      }
      if (delay == null) {
        delay = this.config.defaultDelay;
      }
      if (this.queue.connected) {
        this._send(msg, delay, cb);
      } else {
        this.debug("store message during redis offline time", msg, delay);
        this.offlineQueue.push({
          msg: msg,
          delay: delay,
          cb: cb
        });
      }
      return this;
    };


    /*
    	## del
    
    	`RSMQWorker.del( id )`
    
    	Delete a messge from queue. This is usually done automatically unless you call `next(false)`
    
    	@param { String } id The rsmq message id
    	@param { Function } [cb] A optional callback to get a secure response for a successful delete.
    
    	@return { RSMQWorker } The instance itself for chaining.
    
    	@api public
     */

    RSMQWorker.prototype.del = function(id, cb) {
      this.queue.deleteMessage({
        qname: this.queuename,
        id: id
      }, (function(_this) {
        return function(err, resp) {
          if (err) {
            _this.error("delete queue message", err);
            if (_isFunction(cb)) {
              cb(err);
            }
            return;
          }
          _this.debug("delete queue message", resp);
          _this.emit("deleted", id);
          if (_isFunction(cb)) {
            cb(null);
          }
        };
      })(this));
      return this;
    };


    /*
    	## changeInterval
    
    	`RSMQWorker.changeInterval( interval )`
    
    	Change the interval timeouts in operation
    
    	@param { Number|Array } interval The new interval
    
    	@return { RSMQWorker } The instance itself for chaining.
    
    	@api public
     */

    RSMQWorker.prototype.changeInterval = function(interval) {
      this.config.interval = interval;
      return this;
    };


    /*
    	## info
    
    	`RSMQWorker.info( cb )`
    
    	Get the queue attributes
    
    	@param { Function } cb The callback function
    	
    	@return { RSMQWorker } The instance itself for chaining.
    
    	@api public
     */

    RSMQWorker.prototype.info = function(cb) {
      this.queue.getQueueAttributes({
        qname: this.queuename
      }, (function(_this) {
        return function(err, resp) {
          if (err) {
            _this.error("queue info", err);
            cb(err);
            return;
          }
          cb(null, resp);
        };
      })(this));
      return this;
    };


    /*
    	## size
    
    	`RSMQWorker.size( hidden, cb )`
    
    	Get the queue size.
    	
    	@param { Boolean } [hidden=false] Get the message count of the queue including the currently hidden/"in flight" messages.
    	@param { Function } cb The callback function
    	
    	@return { RSMQWorker } The instance itself for chaining.
    
    	@api public
     */

    RSMQWorker.prototype.size = function() {
      var arg, cb, hidden, i;
      arg = 2 <= arguments.length ? slice.call(arguments, 0, i = arguments.length - 1) : (i = 0, []), cb = arguments[i++];
      hidden = arg[0];
      this.queue.getQueueAttributes({
        qname: this.queuename
      }, (function(_this) {
        return function(err, resp) {
          var _size;
          if (err) {
            _this.error("queue size", err);
            cb(err);
            return;
          }
          _size = (resp != null ? resp.msgs : void 0) || 0;
          if (hidden === true) {
            _size = resp.hiddenmsgs || 0;
          }
          cb(null, _size);
        };
      })(this));
      return this;
    };


    /*
    	## _initRSMQ
    
    	`RSMQWorker._initRSMQ()`
    
    	Initialize rsmq	and handle disconnects
    
    	@api private
     */

    RSMQWorker.prototype._initRSMQ = function() {
      this.queue = this._getRsmq();
      this.reconnectActive = false;
      if (this.queue.connected) {
        this._initQueue();
      } else {
        this.queue.once("connect", this._initQueue);
      }
    };


    /*
    	## _onDisconnect
    
    	`RSMQWorker._onDisconnect()`
    
    	internal handler on disconnect
    	
    	@param { Error } the redis connection error
    
    	@api private
     */

    RSMQWorker.prototype._onDisconnect = function(err) {
      var _interval;
      this.warning("redis connection lost", err);
      _interval = this.timeout != null;
      if (!this.reconnectActive) {
        this.reconnectActive = true;
        if (_interval) {
          this.stop();
        }
        this.queue.once("connect", this._onReConnect);
      }
    };


    /*
    	## _onReConnect
    
    	`RSMQWorker._onReConnect()`
    
    	internal handler on a reconnect
    
    	@api private
     */

    RSMQWorker.prototype._onReConnect = function() {
      this.waitCount = 0;
      this.reconnectActive = false;
      this.queue = this._getRsmq(true);
      this._initQueue();
      this.once("ready", this.interval);
      this.warning("redis connection reconnected");
    };


    /*
    	## _getRsmq
    
    	`RSMQWorker._getRsmq( [forceInit] )`
    
    	get or init the rsmq instance
    
    	@param { Boolean } [forceInit=false] init rsmq even if it has been allready inited
    
    	@return { RedisSMQ } A rsmq instance
    
    	@api private
     */

    RSMQWorker.prototype._getRsmq = function(forceInit) {
      var ref, ref1, ref2, ref3, ref4, ref5;
      if (forceInit == null) {
        forceInit = false;
      }
      if (!forceInit && (this.queue != null)) {
        return this.queue;
      }
      if (((ref = this.config.rsmq) != null ? (ref1 = ref.constructor) != null ? ref1.name : void 0 : void 0) === "RedisSMQ") {
        this.debug("use given rsmq client");
        return this.config.rsmq;
      }
      if (((ref2 = this.config.redis) != null ? (ref3 = ref2.constructor) != null ? ref3.name : void 0 : void 0) === "RedisClient" || ((ref4 = this.config.redis) != null ? (ref5 = ref4.constructor) != null ? ref5.name : void 0 : void 0) === "Redis") {
        return new RSMQ({
          client: this.config.redis,
          ns: this.config.redisPrefix
        });
      } else {
        return new RSMQ({
          host: this.config.host,
          port: this.config.port,
          options: this.config.options,
          ns: this.config.redisPrefix
        });
      }
    };


    /*
    	## _initQueue
    
    	`RSMQWorker._initQueue()`
    
    	check if the given queue exists
    
    	@api private
     */

    RSMQWorker.prototype._initQueue = function() {
      this.queue.createQueue({
        qname: this.queuename
      }, (function(_this) {
        return function(err, resp) {
          if ((err != null ? err.name : void 0) === "queueExists") {
            _this.ready = true;
            _this.emit("ready");
            _this._runOfflineMessages();
            return;
          }
          if (err) {
            throw err;
          }
          if (resp === 1) {
            _this.debug("queue created");
          } else {
            _this.debug("queue allready existed");
          }
          _this.ready = true;
          _this.emit("ready");
          _this._runOfflineMessages();
        };
      })(this));
    };


    /*
    	## _send
    
    	`RSMQWorker._send( msg, delay )`
    
    	Internal send method that directly calls `rsmq.sendMessage()` .
    
    	@param { String } msg The message content
    	@param { Number } delay The message delay to hide this message for the next `x` seconds.
    	@param { Function } [cb] A optional callback function
    
    	@api private
     */

    RSMQWorker.prototype._send = function(msg, delay, cb) {
      this.queue.sendMessage({
        qname: this.queuename,
        message: msg,
        delay: delay
      }, (function(_this) {
        return function(err, resp) {
          if (err) {
            _this.error("send pending queue message", err);
            if ((cb != null) && _isFunction(cb)) {
              cb(err);
            }
            return;
          }
          _this.emit("new", resp);
          if ((cb != null) && _isFunction(cb)) {
            cb(null, resp);
          }
        };
      })(this));
    };


    /*
    	## _runOfflineMessages
    
    	`RSMQWorker._runOfflineMessages()`
    
    	Runn all messages collected by `.send()` while redis has been offline
    
    	@api private
     */

    RSMQWorker.prototype._runOfflineMessages = function() {
      var _aq, i, len, ref, sndData;
      if (this.offlineQueue.length) {
        _aq = async.queue((function(_this) {
          return function(sndData, cb) {
            _this.debug("run offline stored message", arguments);
            _this._send(sndData.msg, sndData.delay, sndData.cb);
            cb();
          };
        })(this), 3);
        ref = this.offlineQueue;
        for (i = 0, len = ref.length; i < len; i++) {
          sndData = ref[i];
          this.debug("queue offline stored message", sndData);
          _aq.push(sndData);
        }
      }
    };


    /*
    	## receive
    
    	`RSMQWorker.receive( _useInterval )`
    
    	Receive a message
    
    	@param { Boolean } _us Fire a `next` event to call e new receive on the call of `next()`
    
    	@api private
     */

    RSMQWorker.prototype.receive = function(_useInterval) {
      if (_useInterval == null) {
        _useInterval = false;
      }
      this.debug("start receive");
      this.queue.receiveMessage({
        qname: this.queuename,
        vt: this.config.invisibletime
      }, (function(_this) {
        return function(err, msg) {
          var _err, _fnNext, _id, error, ref, timeout;
          _this.debug("received", msg);
          if (err) {
            if (_useInterval) {
              _this.emit("next", true);
            }
            _this.error("receive queue message", err);
            return;
          }
          if (msg != null ? msg.id : void 0) {
            _this.emit("data", msg);
            _id = msg.id;
            if (_this.config.timeout > 0) {
              timeout = setTimeout(function() {
                _this.warning("timeout", msg);
                _this.emit("timeout", msg);
                _fnNext(false);
              }, _this.config.timeout);
            }
            _fnNext = _once(function(del) {
              if (del == null) {
                del = true;
              }
              if (_isBoolean(del) || _isNumber(del)) {
                if (del) {
                  _this.del(_id);
                }
              } else if (del != null) {
                _this.emit("error", del, msg);
              }
              if (timeout != null) {
                clearTimeout(timeout);
              }
              if (_useInterval) {
                _this.emit("next");
              }
            });
            try {
              _this.emit("message", msg.message, _fnNext, _id);
            } catch (error) {
              _err = error;
              if (!((ref = _this.listeners("error")) != null ? ref.length : void 0) || _this.config.alwaysLogErrors) {
                _this.error("error", _err);
              }
              _this.emit("error", _err, msg);
              _fnNext(false);
              return;
            }
          } else {
            if (_useInterval) {
              _this.emit("next", true);
            }
          }
        };
      })(this));
    };


    /*
    	## check
    
    	`RSMQWorker.check( msg )`
    
    	Check if a message has been received to often and has to be deleted
    
    	@param { Object } msg The raw rsmq message
    
    	@api private
     */

    RSMQWorker.prototype.check = function(msg) {
      var base;
      if (typeof (base = this.config).customExceedCheck === "function" ? base.customExceedCheck(msg) : void 0) {
        return;
      }
      if (msg.rc >= this.config.maxReceiveCount) {
        this.emit("exceeded", msg);
        this.warning("message received more than " + this.config.maxReceiveCount + " times. So delete it", msg);
        this.del(msg.id);
      }
    };


    /*
    	## interval
    
    	`RSMQWorker.interval()`
    
    	call receive the intervall
    
    	@api private
     */

    RSMQWorker.prototype.interval = function() {
      this.debug("run interval");
      if (!this.stopped) {
        this.receive(true);
      }
    };


    /*
    	## next
    
    	`RSMQWorker.next( [wait] )`
    
    	Call the next recieve or wait until the next recieve has to be called
    
    	@param { Boolean } [wait=false] Tell the next call that the last receive was empty to increase the wait time
    
    	@api private
     */

    RSMQWorker.prototype.next = function(wait) {
      var _timeout;
      if (wait == null) {
        wait = false;
      }
      if (!wait) {
        this.waitCount = 0;
      }
      if (_isArray(this.config.interval)) {
        _timeout = this.config.interval[this.waitCount] != null ? this.config.interval[this.waitCount] : _last(this.config.interval);
      } else {
        if (wait) {
          _timeout = this.config.interval;
        } else {
          _timeout = 0;
        }
      }
      this.debug("wait", this.waitCount, _timeout * 1000);
      if (_timeout >= 0) {
        if (this.timeout != null) {
          clearTimeout(this.timeout);
        }
        this.timeout = _delay(this.interval, _timeout * 1000);
        this.waitCount++;
      } else {
        this.interval();
      }
    };

    return RSMQWorker;

  })(require("mpbasic")());

  module.exports = RSMQWorker;

}).call(this);
