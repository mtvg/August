var Alexa = require('./alexaws');
var config = require('./config');
var p = require('child_process');

var sys = require('sys');
var https = require('https');
var http = require('http');
var url = require('url');
var fs = require('fs');

var augustBridgeCallbacks = [];
var augustBridge;
var augustBridgeMessage = function(m) {
	if (augustBridgeCallbacks[m.callbackId])
		augustBridgeCallbacks[m.callbackId](m.res);
	delete augustBridgeCallbacks[m.callbackId];
}


function execCommand(command, callback, arg) {

	if (!augustBridge || !augustBridge.connected) {
		augustBridge = p.fork(__dirname+'/augustctl/augustbridge.js');
		augustBridge.on('message', augustBridgeMessage);
	}

	var cbackId = augustBridgeCallbacks.push(callback)-1;
	augustBridge.send({cmd:command, callbackId:cbackId, arg:arg});

	return true;
}

var relockTime = 0;
var cachedLockStatus = "unknown"
var cachedEverlockTime = -1

function httpHandler( request, response ){

	var get = url.parse(request.url, true);


	if (get.pathname == config.alexaSkillGatewayURL) {
		var alexa = new Alexa(request, response);
		alexa.on('launch', function () {
        	alexa.setOutputSpeech("What would you like to ask to your August lock?");
        	alexa.setShouldEndSession(false);
    	});
		alexa.on('intent', function (intent, args) {
        	if (intent == "LockDoor") {
        		execCommand('lock');
				alexa.setOutputSpeech("Ok.");
        	}
        	else if (intent == "UnlockDoor") {
        		execCommand('unlock');
				alexa.setOutputSpeech("Ok.");
        	}
        	else if (intent == "UnlockDoorFor") {
				execCommand('everlockOffUnlock');
				relockTime = new Date().getTime() + parseInt(args.Duration)*60000;
				cachedLockStatus = "unlocked"
				cachedEverlockTime = 0
				alexa.setOutputSpeech("Ok. I will lock the door in "+args.Duration+" minutes");
        	}
        	else if (intent == "GetStatus") {
        		alexa.autoSend = false;
				execCommand('getAllStatus', function(status){
					var res = JSON.parse(status);
					alexa.setOutputSpeech(res.lock=='locked'?"The door is locked.":"The door is unlocked.");
					alexa.send();
				});
        	}
        	else {
        		alexa.setOutputSpeech("What would you like to do?");
        		alexa.setShouldEndSession(false);
        	}
    	});
    	return;
	}
	
	response.writeHead( 200, {"content-type": "text/plain", 'Transfer-Encoding':'chunked'} );

	if (get.pathname == config.baseURL+'/relocktime') {
		var remainingTime = 0;
		if (relockTime)
			remainingTime = Math.max(0, Math.ceil((relockTime - new Date().getTime())/1000));
			
		response.end('{"remaining":'+remainingTime+'}');
	} 
	else
	if (get.pathname == config.baseURL+'/cached') {
		var remainingTime = 0;
		if (relockTime)
			remainingTime = Math.max(0, Math.ceil((relockTime - new Date().getTime())/1000));
			
		response.end('{"remaining":'+remainingTime+', "lock":"'+cachedLockStatus+'", "everlocktime":'+cachedEverlockTime+'}');
	} 
	else
	if (get.pathname == config.baseURL+'/unlock') {
		execCommand('unlock');
		if (cachedEverlockTime<=0) cachedLockStatus = "unlocked"
		response.end('{"system":"unlocking"}');
	}
	else
	if (get.pathname == config.baseURL+'/lock') {
		execCommand('lock');
		if (cachedEverlockTime<=0) cachedLockStatus = "locked"
		response.end('{"system":"locking"}');
	}
	else
	if (get.pathname == config.baseURL+'/neverlock') {
		execCommand('everlockOffUnlock');
		if (get.query.relock)
			relockTime = new Date().getTime() + parseInt(get.query.relock)*1000;
		else
			relockTime = 0;
		cachedLockStatus = "unlocked"
		cachedEverlockTime = 0
		response.end('{"system":"neverlocking"}');
	}
	else
	if (get.pathname == config.baseURL+'/everlock') {
		execCommand('everlockOnLock', undefined, config.autolockTime);
		relockTime = 0;
		cachedLockStatus = "locked"
		cachedEverlockTime = config.autolockTime
		response.end('{"system":"everlocking"}');
	}
	else 
	if (get.pathname == config.baseURL+'/status') {
		execCommand('getAllStatus', function(status){
			var res = JSON.parse(status);
			cachedLockStatus = res.lock;
			cachedEverlockTime = res.everlocktime;
			response.end(status);
		});
	}
	else {
		response.writeHead(404, {"Content-Type": "text/plain"});
		response.end('not found');
	}
}
if (config.httpsServerPort) {
	var options = {
	  key: fs.readFileSync(config.sslKey),
	  cert: fs.readFileSync(config.sslCert)
	};
	var serverssl = https.createServer(options, httpHandler)
	serverssl.listen( config.httpsServerPort );
}
if (config.httpServerPort) {
	var server = http.createServer(httpHandler);
	server.listen( config.httpServerPort );
}


setInterval(function(){
	if (relockTime && relockTime < new Date().getTime()) {
		execCommand('everlockOnLock', config.autolockTime);
		cachedLockStatus = "locked";
		cachedEverlockTime = config.autolockTime;
		relockTime = 0;
	}

}, 1000);
 
execCommand('getAllStatus', function(status){
	var res = JSON.parse(status);
	cachedLockStatus = res.lock;
	cachedEverlockTime = res.everlocktime;
});
