#!/usr/bin/env node

var Lock = require('./lock');
var noble = require('noble');
var config = require('../config');
var nobleStatus = "scanning";
var commandStatus = "idle";
var augustLock;

noble.on('stateChange', function(state) {
  if (state === 'poweredOn') {
    noble.startScanning([ Lock.BLE_COMMAND_SERVICE ]);
  } else {
    noble.stopScanning();
  }
});

noble.on('discover', function(peripheral) {
  if (config.uuid === undefined || peripheral.uuid === config.uuid) {
    noble.stopScanning();

    nobleStatus = "disconnected";

    augustLock = new Lock(
      peripheral,
      config.offlineKey,
      config.offlineKeyOffset
    );

    peripheral.on('disconnect', function() {
      nobleStatus = "disconnected";
      checkQueue();
    });

    checkQueue();  
  }
});

var cmdsQueue = [];
var argsQueue = [];
var cbksQueue = [];
function execOrQueue(cmd, arg, cbk) {
  cmdsQueue.push(cmd);
  argsQueue.push(arg);
  cbksQueue.push(cbk);

  checkQueue();
}

function checkQueue() {
  if (cmdsQueue.length > 0) {
    if (nobleStatus == "scanning" || nobleStatus == "connecting" || nobleStatus == "disconnecting") return;
    if (nobleStatus == "disconnected") {
      nobleStatus = "connecting";
      augustLock.connect().then(function() {
        nobleStatus = "connected";
        checkQueue();
      });
      return;
    }
    else if (commandStatus == "idle") {
      if (cmdsQueue[0] == "disconnect") nobleStatus = "disconnecting";
      commandStatus = "running";
      var cbkId = cbksQueue.shift();
      augustLock[cmdsQueue.shift()](argsQueue.shift()).then(function(ret) {
        commandStatus = "idle";
        process.send({callbackId:cbkId, res:ret});
        checkQueue();
      });
      return;
    }
  }
}

process.on('message', function(m) {
  execOrQueue(m.cmd, m.arg, m.callbackId);
});


