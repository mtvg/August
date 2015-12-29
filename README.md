# August

*Based on the work of Dan Walters: [https://github.com/sretlawd/augustctl](https://github.com/sretlawd/augustctl)*

TODO: Fork *augustctl* to merge some features of this project, and use *augustctl* as a dependency.

## Info
This NodeJS script creates a web server that controls an August Lock via Bluetooth LE.

The server will respond to Alexa Skill requests. ([https://youtu.be/dMDONhdPdxo](https://youtu.be/dMDONhdPdxo))

The server also respond to those actions:

 - `https://server:port/august/control/status` gets the lock status
 - `https://server:port/august/control/lock` locks the door
 - `https://server:port/august/control/unlock` unlocks the door
 - `https://server:port/august/control/neverlock` unlocks the door and disables the autolock feature
 - `https://server:port/august/control/everlock` locks the door and enables the autolock feature
 - `https://server:port/august/control/neverlock?relock=3600` unlocks the door and automatically everlocks the door after 1 hour (3600sec)
 - `https://server:port/august/control/cached` returns the last known lock status without requesting the lock 
 - `https://server:port/august/control/relocktime` returns the time remaining after a `neverlock?relock=3600` call
 
**I haven't implemented any kind of security, it is more a proof of concept than a real project. Use this at your own risk.**

## Requirements

For this project I've used:

- RaspberryPi B+
- [WiFi dongle](http://www.amazon.com/gp/product/B008IFXQFU)
- [Bluetooth 4 dongle](http://www.amazon.com/gp/product/B00IMALQ94)
- August Lock
- Amazon Echo

You only need to install `node` and `npm` on your pi.

## Setup

Here are my old notes for my basic setup:

- Install Raspbian
- Activate SSH
- Install WiFi Drivers for TL-WN725n: [laurenthinoul.com](http://laurenthinoul.com/how-to-install-tp-link-tl-wn725n-on-raspberry-pi/) or use `pi/install-8188eu.sh`
- Config WiFi: [learn.adafruit.com](https://learn.adafruit.com/adafruits-raspberry-pi-lesson-3-network-setup/setting-up-wifi-with-occidentalis)
- Install Node: [joshondesign.com](http://joshondesign.com/2013/10/23/noderpi)


### Config


- Login to your Pi and clone this project in your home directory (`/home/pi/`): `git clone git://github.com/mtvg/August`
- Install dependencies inside the project directory: `npm install`
- Edit the `config.js` file, and add your SSL certificate files if you're enabling the HTTPS server
- Clone `fauxmo` in your home directory: `git clone git://github.com/makermusings/fauxmo`
- Clone and install `fauxmo` dependency: `git clone git://github.com/kennethreitz/requests.git` then in the requests folder: `sudo python setup.py install`
- [Configure](#alexa-using-virtual-wemo-switch) `fauxmo.py`

### Test

Run `sudo node august/august-server.js` and try opening `http://raspberrypi.local:8080/august/control/status` on your computer 


### Startup /etc/rc.local

Edit `/etc/rc.local` and add those lines in order to make things start automatically on startup:

```
PATH=$PATH:/usr/local/bin/

node /home/pi/august/august-server.js > /home/pi/august.log 2> /home/pi/august_err.log &
/home/pi/fauxmo/fauxmo.py &
```




## Getting your offline key:
The offline key is an encryption key used by the lock to communicate securely through a BLE communication.
This key is stored in the offical August app preferences on both iOS and Android.

I'm only going to cover how to retreive the key using an iPhone and OSX, please read [this](https://github.com/sretlawd/augustctl#android-phone-with-root) for Android.

In order for the August app to save the offline key to your preferences file, the AutoUnlock feature has to be activated at least once. (You can disable it right after) 

- Create an **unencrypted** backup of your iOS device on your computer. (Uncheck "Encrypt iPhone backup" in iTunes)
- Use [iPhone Backup Extractor](http://supercrazyawesome.com/) to extract the data of the app named ```com.august.iosapp``` ([more details here](http://adriansieber.com/how-to-extract-data-from-ios-apps-on-mac-os/), a Windows alternative probably exsists)
- Open the file ```com.august.iossapp/Library/Preferences/com.august.iossapp.plist``` using Xcode or any binary plist viewer
- Look inside ```Root/AGCurrentUserOfflineKey_XXXXXXXXXXXXXX```, and copy the value of ```key``` and ```slot```


## Alexa using virtual WeMo switch

With this method, no need to expose your webserver to the world. And the voice command is more natural than using a Skill for Alexa. But you'll be limited to just open and close the door.

You can say: "Alexa, open the *door*" or "Alexa, close the *door*" (*door* is the name of your virtual WeMo device, you can change it if you want)

For this, we're gonna use [fauxmo](https://github.com/makermusings/fauxmo)

Download and install the python script to your RaspberryPi and edit the end of the file as this:

	FAUXMOS = [
    	['Door', rest_api_handler('http://127.0.0.1:8080/august/control/unlock', 'http://127.0.0.1:8080/august/control/lock')]
	]


## Alexa Skill

Setup a new Skill in your [Amazon Developer Conosole](https://developer.amazon.com/edw/home.html#/skills/list)

Create a self-signed certificate and save your `key` and `cert` as `.pem` files for our HTTPS web server

### Intent Schema

	{
	  "intents": [
      {
        "intent": "UnlockDoorFor",
        "slots": [
          {
            "name": "Duration",
            "type": "NUMBER"
          }
        ]
      },
      {
        "intent": "LockDoor"
      },
      {
        "intent": "UnlockDoor"
      },
      {
        "intent": "GetStatus"
      }
      ]
    }

### Sample Utterances

	LockDoor lock the door
	LockDoor lock
	LockDoor close the door
	LockDoor close
	UnlockDoor unlock the door
	UnlockDoor unlock
	UnlockDoor open the door
	UnlockDoor open
	UnlockDoorFor unlock the door for {twenty|Duration} minutes
	UnlockDoorFor lock the door in {twenty|Duration} minutes
	UnlockDoorFor open the door for {twenty|Duration} minutes
	UnlockDoorFor close the door in {twenty|Duration} minutes
	GetStatus what is the status of the lock
	GetStatus what is your status
	GetStatus what is the status of the door
	GetStatus what is the status of august

 
 
