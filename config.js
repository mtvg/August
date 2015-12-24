var config = {};

config.offlineKey = "0123456789abcdef0123456789abcdef";
config.offlineKeyOffset = 1;

config.sslKey = __dirname+"/ssl-key.pem";
config.sslCert = __dirname+"/ssl-cert.pem";

config.alexaSkillGatewayURL = "/august/alexa";
config.baseURL = "/august/control";
config.httpsServerPort = 8443; //comment if no https server required (https used by alexa skill)
config.httpServerPort = 8080; //comment if no http server required (http used by fauxmo)

config.autolockTime = 60;



module.exports = config;