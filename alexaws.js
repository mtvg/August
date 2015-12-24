var util = require('util');
var EventEmitter = require('events').EventEmitter;

function Alexa(request, response) {

	var self = this;
	var requestJSONBody = '';
	var requestBody;
	var respondObject = {
		"version": "1.0",
		"sessionAttributes": {},
		"response": {
			"shouldEndSession": true
		}
	};
	this.sessionAttributes = {};
	this.autoSend = true;

	this.setShouldEndSession = function(endSession) {
		respondObject.response.shouldEndSession = endSession?true:false;
	}

	this.setOutputSpeech = function(text) {
		if (text) {
			respondObject.response.outputSpeech = {
				"type": "PlainText",
				"text": text
			};
		} else {
			delete respondObject.response.outputSpeech;
		}
	}

	this.getSessionId = function() {
		if (requestBody)
			return requestBody.session.sessionId;
		else return null;
	}

	this.isNewSession = function() {
		if (requestBody)
			return requestBody.session['new'];
		else return null;
	}

    function parseJSONBody() {
    	var jsonParsed = true;
    	try {
    		requestBody = JSON.parse(requestJSONBody);
    	} catch (e) {
			jsonParsed = false;
    	}

    	if (jsonParsed) {
	    	self.sessionAttributes = requestBody.session.attributes;

	    	if (requestBody.request.type == "LaunchRequest")
	    		self.emit('launch');
	    	if (requestBody.request.type == "IntentRequest")
	    		self.emit('intent', requestBody.request.intent.name, parseSlots(requestBody.request.intent.slots));
	    	if (requestBody.request.type == "SessionEndedRequest")
	    		self.emit('end', requestBody.request.reason);
    	}

    	if (self.autoSend) 
    		self.send();
    }

    function parseSlots(requestSlots) {
    	var args = {};
    	for (var o in requestSlots)
    		args[o] = requestSlots[o].value;
    	return args;
    }

    this.send = function() {
    	var payload = JSON.stringify(respondObject);
		response.writeHead( 200, {"Content-Type": "application/json;charset=UTF-8", "Content-Length": Buffer.byteLength(payload, 'utf8')} );
		response.end(payload);
    }

    request.on('data', function (data) {
        requestJSONBody += data;
    });

    request.on('end', parseJSONBody);
}

util.inherits(Alexa, EventEmitter);
module.exports = Alexa;
