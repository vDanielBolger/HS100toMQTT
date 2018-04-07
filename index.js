#!/usr/bin/env node

const MqttSmarthome = require("mqtt-smarthome-connect");
const Hs100Api = require('tplink-smarthome-api');
const log = require('yalm');
const shortid = require('shortid');
//const log = {setLevel: ()=>{}, debug: console.log, info: console.log, warn: console.log, error: console.log };

const pkg = require('./package.json');
const config = require('yargs')
    .env('HS100TOMQTT')
    .usage(pkg.name + ' ' + pkg.version + '\n' + pkg.description + '\n\nUsage: $0 [options]')
    .describe('verbosity', 'possible values: "error", "warn", "info", "debug"')
    .describe('name', 'instance name. used as mqtt client id and as prefix for connected topic')
    .describe('mqtt-url', 'mqtt broker url. See https://github.com/mqttjs/MQTT.js#connect-using-a-url')
    .describe('polling-interval', 'polling interval (in ms) for status updates')
    .describe('devices', 'list of device IPs as String, multiple IPs separated by space')
    .alias({
        h: 'help',
        m: 'mqtt-url',
        v: 'verbosity'
    })
    .default({
        name: 'hs100',
        'mqtt-url': 'mqtt://127.0.0.1',
        'polling-interval': 3000
    })
    .version()
    .help('help')
    .argv;

let devices = [];

log.setLevel(config.verbosity);
log.info(pkg.name + ' ' + pkg.version + ' starting');
log.debug("loaded config: ", config);
if (typeof config.devices === 'string') {
    config.devices.split(" ").forEach( (ip) => {
        devices.push({"host":ip, "port":9999});
    });
}

log.info('mqtt trying to connect', config.mqttUrl);
const mqtt = new MqttSmarthome(config.mqttUrl, {
    logger: log,
    clientId: config.name + '_' + + shortid.generate(),
    will: {topic: config.name + '/connected', payload: '0', retain: true}
});
mqtt.connect();

mqtt.on('connect', () => {
    log.info('mqtt connected', config.mqttUrl);
    mqtt.publish(config.name + '/connected', '1', {retain: true});
});

const client = new Hs100Api.Client({logLevel: config.verbosity, logger: log});

client.on('device-new', (device) => {
    log.info('hs100 device-new', device.model, device.host, device.deviceId, device.name);
    mqtt.publish(config.name + "/status/" + device.deviceId + "/online", true);
    mqtt.subscribe(config.name + "/set/" + device.deviceId + "/poweron", (topic, payload, packet) => {
        device.setPowerState(payload);
    });

    device.startPolling(config.pollingInterval);

    device.on('power-on', () => { 
        log.debug('hs100 power-on callback', device.name);
        mqtt.publish(config.name + "/status/" + device.deviceId + "/poweron", true);
    });
    device.on('power-off', () => { 
        log.debug('hs100 power-off callback', device.name);
        mqtt.publish(config.name + "/status/" + device.deviceId + "/poweron", false);
    });
    device.on('power-update', (powerOn) => { 
        log.debug('hs100 power-update callback', device.name, powerOn);
        mqtt.publish(config.name + "/status/" + device.deviceId + "/poweron", powerOn);
    });

    device.on('emeter-realtime-update', (consumption) => { 
        log.debug('hs100 emeter-realtime-update callback', device.name, String(consumption.power) );
        mqtt.publishMulti(config.name + "/status/" + device.deviceId + "/consumption", consumption);
    });
});
client.on('device-online', (device) => { 
    log.debug('hs100 device-online callback', device.name);
    mqtt.publish(config.name + "/status/" + device.deviceId + "/online", true);
});
client.on('device-offline', (device) => { 
    log.warn('hs100 device-offline callback', device.name);
    mqtt.publish(config.name + "/status/" + device.deviceId + "/online", false);
});

log.info('Starting Device Discovery');
client.startDiscovery({
    devices: devices
});
