var Promise = require('bluebird');
var crypto = require('crypto');
var debug = require('debug')('august');
var events = require('events');
var noble = require('noble');
var util = require('util');
var _ = require('underscore');

// promisification of noble
Promise.promisifyAll(require('noble/lib/characteristic').prototype);
Promise.promisifyAll(require('noble/lib/peripheral').prototype);
Promise.promisifyAll(require('noble/lib/service').prototype);

// relevant UUIDs - w/ this library, must be lowercase and without hyphens
const BLE_COMMAND_SERVICE = "bd4ac6100b4511e38ffd0800200c9a66";
const BLE_COMMAND_WRITE_CHARACTERISTIC = "bd4ac6110b4511e38ffd0800200c9a66";
const BLE_COMMAND_READ_CHARACTERISTIC = "bd4ac6120b4511e38ffd0800200c9a66";
const BLE_COMMAND_SECURE_WRITE_CHARACTERISTIC = "bd4ac6130b4511e38ffd0800200c9a66";
const BLE_COMMAND_SECURE_READ_CHARACTERISTIC = "bd4ac6140b4511e38ffd0800200c9a66";


///
// Checksum
// calculate checksum
function cksum8(buffer) {
  var total = 0;
  for (var i=0; i<buffer.length; i++)
    total += buffer.readUInt8(i);
  return (~(total & 0xff) + 1) & 0xFF;
}

///
// LockCommand
// basically, a zero initialized 18 byte Buffer

function LockCommand() {
  var cmd = new Buffer(0x12);
  cmd.fill(0x00);
  return cmd;
}

// Calculates the security checksum of a command buffer.
function securityChecksum(buffer) {
  return (0 - (buffer.readUInt32LE(0x00) + buffer.readUInt32LE(0x04) + buffer.readUInt32LE(0x08))) >>> 0;
}

///
// LockSession

function LockSession(writeCharacteristic, readCharacteristic, isSecure) {
  if (!writeCharacteristic || !readCharacteristic) {
    throw new Error('write and/or read characteristic not found');
  }
  this._writeCharacteristic = writeCharacteristic;
  this._readCharacteristic = readCharacteristic;
  this._isSecure = isSecure;
  return this;
}

util.inherits(LockSession, events.EventEmitter);

LockSession.prototype.setKey = function(key) {
  var cipherSuite, iv;
  if (this._isSecure) {
    cipherSuite = 'aes-128-ecb';
    iv = '';
  } else {
    cipherSuite = 'aes-128-cbc';
    iv = new Buffer(0x10);
    iv.fill(0);
  }

  this._encryptCipher = crypto.createCipheriv(cipherSuite, key, iv);
  this._encryptCipher.setAutoPadding(false);
  this._decryptCipher = crypto.createDecipheriv(cipherSuite, key, iv);
  this._decryptCipher.setAutoPadding(false);
};

LockSession.prototype.start = function() {
  // decrypt all reads, modifying the buffer in place
  this._readCharacteristic.on('read', function(data, isNotify) {
    if (!data) {
      throw new Error('read returned no data');
    }

    debug('read data: ' + data.toString('hex'));

    if (this._decryptCipher) {
      var cipherText = data.slice(0x00, 0x10);
      var plainText = this._decryptCipher.update(cipherText);
      plainText.copy(cipherText);

      debug('decrypted data: ' + data.toString('hex'));
    }

    // the notification flag is not being set properly on OSX Yosemite, so just
    // forcing it to true.
    if (process.platform === 'darwin') {
      isNotify = true;
    }

    if (isNotify) {
      this.emit('notification', data);
    }
  }.bind(this));

  // enable notifications on the read characterestic
  debug('enabling notifications on ' + this._readCharacteristic);
  return this._readCharacteristic.notifyAsync(true);
};

LockSession.prototype.execute = function(command) {
  // write the security checksum if on the secure channel
  if (this._isSecure) {
    var checksum = securityChecksum(command);
    command.writeUInt32LE(checksum, 0x0c);
  }

  debug((this._isSecure ? 'secure ' : '') + 'execute command: ' + command.toString('hex'));

  // NOTE: the last two bytes are not encrypted
  // general idea seems to be that if the last byte of the command indicates an offline key offset (is non-zero), the command is "secure" and encrypted with the offline key
  if (this._encryptCipher) {
    var plainText = command.slice(0x00, 0x10);
    var cipherText = this._encryptCipher.update(plainText);
    cipherText.copy(plainText);
    debug('execute command (encrypted): ' + command.toString('hex'));
  }

  // register the notification event listener here, before issuing the write, as the
  // response notification arrives before the write response.
  var waitForNotification = new Promise(function(resolve) {
    this.once('notification', resolve);
  }.bind(this));

  return this._writeCharacteristic.writeAsync(command, false).then(function() {
    debug('write successful, waiting for notification...');
    return waitForNotification;
  }).then(function(data) {
    // perform some basic validation before passing it on
    if (this._isSecure) {
      if (securityChecksum(data) !== data.readUInt32LE(0x0c)) {
        throw new Error("security checksum mismatch");
      }
    } else {
      if (data[0] !== 0xbb && data[0] !== 0xaa) {
        throw new Error("unexpected magic in response");
      }
    }

    return data;
  }.bind(this));
};

///
// Lock object.

function Lock(peripheral, offlineKey, offlineKeyOffset) {
  this._peripheral = peripheral;
  this._offlineKey = offlineKey;
  this._offlineKeyOffset = offlineKeyOffset;

  debug('peripheral: ' + util.inspect(peripheral));
}

Lock.prototype.connect = function() {
  var handshakeKeys;
  return this._peripheral.connectAsync().then(function() {
    debug('connected.');
    return this._peripheral.discoverServicesAsync([ BLE_COMMAND_SERVICE ]);
  }.bind(this)).then(function(services) {
    debug('services: ' + util.inspect(services));
    if (services.length !== 1) {
      throw new Error("expected exactly one service");
    }
    return services[0].discoverCharacteristicsAsync([]);
  }).then(function(characteristics) {
    debug('characteristics: ' + util.inspect(characteristics));

    // initialize the secure session
    this._secureSession = new LockSession(
      _.findWhere(characteristics, {uuid: BLE_COMMAND_SECURE_WRITE_CHARACTERISTIC}),
      _.findWhere(characteristics, {uuid: BLE_COMMAND_SECURE_READ_CHARACTERISTIC}),
      true
    );
    this._secureSession.setKey(new Buffer(this._offlineKey, 'hex'));

    // intialize the session
    this._session = new LockSession(
      _.findWhere(characteristics, {uuid: BLE_COMMAND_WRITE_CHARACTERISTIC}),
      _.findWhere(characteristics, {uuid: BLE_COMMAND_READ_CHARACTERISTIC}),
      false
    );

    // start the sessions
    return Promise.join(
      this._secureSession.start(),
      this._session.start()
    );
  }.bind(this)).then(function() {
    // generate handshake keys
    handshakeKeys = crypto.randomBytes(16);

    // send SEC_LOCK_TO_MOBILE_KEY_EXCHANGE
    var cmd = new LockCommand();
    cmd.writeUInt8(0x01, 0x00);    // cmdSecuritySendMobileKeyWithIndex
    handshakeKeys.copy(cmd, 0x04, 0x00, 0x08);
    cmd.writeUInt8(0x0f, 0x10);
    cmd.writeUInt8(this._offlineKeyOffset, 0x11);
    return this._secureSession.execute(cmd);
  }.bind(this)).then(function(response) {
    // setup the session key
    var sessionKey = new Buffer(16);
    handshakeKeys.copy(sessionKey, 0x00, 0x00, 0x08);
    response.copy(sessionKey, 0x08, 0x04, 0x0c);
    this._session.setKey(sessionKey);

    // rekey the secure session as well
    this._secureSession.setKey(sessionKey);

    // send SEC_INITIALIZATION_COMMAND
    var cmd = new LockCommand();
    cmd.writeUInt8(0x03, 0x00);    // cmdSecurityInitializationCommandWithIndex
    handshakeKeys.copy(cmd, 0x04, 0x08, 0x10);
    cmd.writeUInt8(0x0f, 0x10);
    cmd.writeUInt8(this._offlineKeyOffset, 0x11);
    return this._secureSession.execute(cmd);
  }.bind(this));
};

Lock.prototype.forcelock = function() {
  debug('locking...');

  var cmd = new LockCommand();
  cmd.writeUInt8(0xee, 0x00); // magic
  cmd.writeUInt8(0x0b, 0x01); // cmdLock
  cmd.writeUInt8(0x05, 0x03); // simpleChecksum
  cmd.writeUInt8(0x02, 0x10);
  return this._session.execute(cmd);
};

Lock.prototype.forceunlock = function() {
  debug('unlocking...');

  var cmd = new LockCommand();
  cmd.writeUInt8(0xee, 0x00); // magic
  cmd.writeUInt8(0x0a, 0x01); // cmdUnlock
  cmd.writeUInt8(0x06, 0x03); // simpleChecksum
  cmd.writeUInt8(0x02, 0x10);
  return this._session.execute(cmd);
};

Lock.prototype.lock = function() {
  return this.getLockStatus(true).then(function(status) {
    if (status == 'unlocked')
      return this.forcelock();
  }.bind(this));
};

Lock.prototype.unlock = function() {
  return this.getLockStatus(true).then(function(status) {
    if (status == 'locked')
      return this.forceunlock();
  }.bind(this));
};

Lock.prototype.getLockStatus = function() {
  debug('lock status...');

  var cmd = new LockCommand();
  cmd.writeUInt8(0xee, 0x00); // magic
  cmd.writeUInt8(0x02, 0x01); 
  cmd.writeUInt8(0x0c, 0x03); // simpleChecksum
  cmd.writeUInt8(0x02, 0x04); 
  cmd.writeUInt8(0x02, 0x10);
  return this._session.execute(cmd).then(function(response) {
    var status = response.readUInt8(0x08);

    var strstatus = 'unknown';
    if (status == 0x03)
      strstatus = 'unlocked';
    else if (status == 0x05)
      strstatus = 'locked';

    return strstatus;

  }.bind(this));
};

Lock.prototype.everlockOn = function(time) {
  debug('activate everlock...');
  //ee0300a9280000001e001e00000000000200

  var locktime = Math.min(300, Math.max(10, time?time:30));

  var cmd = new LockCommand();

  cmd.writeUInt8(0xee, 0x00); // magic
  cmd.writeUInt8(0x03, 0x01); 
  //cmd.writeUInt8(0xa9, 0x03); // simpleChecksum
  cmd.writeUInt8(0x28, 0x04);
  cmd.writeUInt16LE(locktime, 0x08);
  cmd.writeUInt16LE(locktime, 0x0a);
  cmd.writeUInt8(0x02, 0x10);

  cmd.writeUInt8(cksum8(cmd), 0x03); // simpleChecksum
  return this._session.execute(cmd);
};

Lock.prototype.everlockOnLock = function(time) {
  return this.everlockOn(time).then(function(response) {
    return this.lock();
  }.bind(this));
};

Lock.prototype.everlockOff = function() {
  debug('desactivate everlock...');

  var cmd = new LockCommand();

  //ee0300e52800000000000000000000000200

  cmd.writeUInt8(0xee, 0x00); // magic
  cmd.writeUInt8(0x03, 0x01); 
  cmd.writeUInt8(0xe5, 0x03); // simpleChecksum
  cmd.writeUInt8(0x28, 0x04);
  cmd.writeUInt8(0x02, 0x10);
  return this._session.execute(cmd);
};

Lock.prototype.everlockOffUnlock = function() {
  return this.everlockOff().then(function(response) {
    return this.unlock();
  }.bind(this));
};

Lock.prototype.getEverlockTime = function() {
  debug('everlock time...');

  var cmd = new LockCommand();
//ee0400e42800000000000000000000000200

  cmd.writeUInt8(0xee, 0x00); // magic
  cmd.writeUInt8(0x04, 0x01); 
  cmd.writeUInt8(0xe4, 0x03); // simpleChecksum
  cmd.writeUInt8(0x28, 0x04);
  cmd.writeUInt8(0x02, 0x10);
  return this._session.execute(cmd).then(function(response) {
    var time = response.readUInt16LE(0x08);
    return time;

  }.bind(this));
};

Lock.prototype.getAllStatus = function() {
  var lockStatus;
  return this.getLockStatus().then(function(res) {
    lockStatus = res;
    return this.getEverlockTime();
  }.bind(this)).then(function(time) {
    return '{"lock":"'+lockStatus+'", "everlocktime":'+time+'}';
  }.bind(this));
}

Lock.prototype.disconnect = function() {
  debug('disconnecting...');

  var cmd = new LockCommand();
  cmd.writeUInt8(0x05, 0x00);  // cmdSecurityTerminate
  cmd.writeUInt8(0x0f, 0x10);
  return this._secureSession.execute(cmd).then(function() {
    this._peripheral.disconnect();
  }.bind(this));
};

// expose the service uuid
Lock.BLE_COMMAND_SERVICE = BLE_COMMAND_SERVICE;

module.exports = Lock;
