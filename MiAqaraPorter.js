"use strict";
const dgram = require('dgram');
const utils = require('./utils');
const http = require('http');
const querystring = require('querystring');

let porterTarget = {
    host: '128.0.0.1',
    port: 8080,
    path: '/update',
}

//设置启动获取到网关信息之后的操作
let event = {
    'onready': function () {
        setInterval(function () {
            read('传感器设备的sid');
        }, 60000 * 60); //一个小时
    }
};

let defaultConfig = {
    bindAddress: '', //执行node的硬件有多网络时需要设置本机接受组播消息的ip地址
    iv: new Buffer([0x17, 0x99, 0x6d, 0x09, 0x3d, 0x28, 0xdd, 0xb3, 0xba, 0x69, 0x5a, 0x2e, 0x6f, 0x58, 0x56, 0x2e]),
    multicastAddress: '224.0.0.50', //组播地址
    multicastPort: 4321, //组播端口
    serverPort: 9898    //自己监听端口
};

//以下内容可以不用修改
const DEVICE_MAP = {
    'gateway': {name: 'Gateway', name_cn: '网关'},
    'magnet': {name: 'ContactSensor', name_cn: '门窗磁传感器'},
    'motion': {name: 'MotionSensor', name_cn: '人体感应'},
    'switch': {name: 'Button', name_cn: '按钮'},
    'sensor_ht': {name: 'TemperatureAndHumiditySensor', name_cn: '温度湿度传感器'},
    'ctrl_neutral1': {name: 'SingleSwitch', name_cn: '单按钮墙壁开关'},
    'ctrl_neutral2': {name: 'DuplexSwitch', name_cn: '双按钮墙壁开关'},
    'ctrl_ln1': {name: 'SingleSwitchLN', name_cn: '单按钮墙壁开关零火版'},
    'ctrl_ln2': {name: 'DuplexSwitchLN', name_cn: '双按钮墙壁开关零火版'},
    '86sw1': {name: 'SingleButton86', name_cn: '86型无线单按钮开关'},
    '86sw2': {name: 'DuplexButton86', name_cn: '86型无线双按钮开关'},
    'plug': {name: 'PlugBase', name_cn: '插座'},
    '86plug': {name: 'PlugBase86', name_cn: '86型墙壁插座'},
    'cube': {name: 'MagicSquare', name_cn: '魔方'},
    'smoke': {name: 'SmokeDetector', name_cn: '烟雾警报器'},
    'natgas': {name: 'NatgasDetector', name_cn: '天然气警报器'},
    'curtain': {name: 'ElectricCurtain', name_cn: '电动窗帘'},
    'sensor_magnet.aq2': {name: 'ContactSensor2', name_cn: '门磁感应 第二代'},
    'sensor_motion.aq2': {name: 'MotionSensor2', name_cn: '人体感应 第二代'},
    'sensor_switch.aq2': {name: 'Button2', name_cn: '按钮 第二代'},
    'weather.v1': {name: 'TemperatureAndHumiditySensor2', name_cn: '温度湿度传感器 第二代'},
    'sensor_wleak.aq1': {name: 'WaterDetector', name_cn: '水浸传感器'},
    'unknow': {name: 'unknow', name_cn: '未知设备'}
};

const STATUS = {
    open: '开启',
    close: '关闭',
    motion: '有人移动', // 有人移动
    click: '单击',
    double_click: '双击',
    both_click: '同按', // 左右键同时按
    on: 'on',
    off: 'off'
};

let gateway = {'ip': '', 'port': '', 'sid': '', 'token': ''};
let serverSocket;

function getNameByModel(model) {
    if (DEVICE_MAP.hasOwnProperty(model)) {
        return DEVICE_MAP[model];
    }
    return DEVICE_MAP['unknow'];
}

function postData(data) {
    var req = http.request({
        method: 'post',
        hostname: porterTarget.host,
        port: porterTarget.port,
        path: porterTarget.path,
    }, function (response) {
    });
    req.on('error', (e) => {
        console.error(`请求遇到问题: ${e.message}`);
    });
    req.write(querystring.stringify(data));//发送内容
    req.end();
}

function handleData(data) {
    switch (data['model']) {
        case 'magnet':
            console.log(getNameByModel(data['model']).name + ':' + STATUS[data['data']['status']]);
            break;
        case 'sensor_ht':
            postData({
                model: data['model'],
                temperature: data['data']['temperature'] / 100,
                humidity: data['data']['humidity'] / 100,
                voltage: data['data']['voltage'],
            });
            break;
    }
}

function parseMessage(msg, rinfo) {
    var data;
    try {
        data = JSON.parse(msg); // msg is a Buffer
        if (data.hasOwnProperty('data')) {
            data.data = JSON.parse(data.data);
        }
    } catch (e) {
        console.error('Bad message: %s', msg);
        return;
    }
    var cmd = data['cmd'];
    console.info('[Message] cmd: %s, msg: ', cmd, msg.toString());
    switch (cmd) {
        case 'iam':
            //获取网关信息
            gateway.ip = data['ip'];
            gateway.port = data['port'];
            gateway.sid = data['sid'];
            gateway.token = data['token'];
            event.onready();
            break;
        case 'get_id_list_ack' :
            break;
        case  'report':
            // 设备状态上报
            handleData(data);
            break;
        case 'read_ack':
            handleData(data);
            break;
        case 'write_ack':
            break;
        case 'server_ack':
            break;
        case 'heartbeat':
            /**
             * 网关每10秒钟发送一次, 主要更新网关token
             * 子设备心跳，插电设备10分钟发送一次，其它1小时发送一次
             * */
            if (data['model'] == 'gateway') {
                gateway.token = data['token'];
            }
            break;
    }
}

/**
 * 读设备
 * @param {String} sid 设备ID
 * */
function read(sid) {
    send(gateway.ip, gateway.port, {
        cmd: 'read',
        sid: sid
    });
}

function startService() {
    serverSocket = dgram.createSocket({
        type: 'udp4',
        reuseAddr: true
    });

    serverSocket.on('error', function (err) {
        console.error('error, msg - %s, stack - %s\n', err.message, err.stack);
    });

    serverSocket.on('listening', function () {
        console.info(`server is listening on port ${defaultConfig.serverPort}.`);
        if (!defaultConfig.bindAddress) {
            serverSocket.addMembership(defaultConfig.multicastAddress);
        } else {
            serverSocket.setMulticastInterface(defaultConfig.bindAddress);
            serverSocket.addMembership(defaultConfig.multicastAddress, defaultConfig.bindAddress);
        }
        send(defaultConfig.multicastAddress, defaultConfig.multicastPort, {cmd: 'whois'});
    });
    serverSocket.on('message', parseMessage.bind(this));
    serverSocket.bind(defaultConfig.serverPort);
}

function send(ip, port, msg) {
    if (!ip || !port || !msg) {
        console.error('Param error. ip,port or msg is required');
    }
    var msgStr = utils.messageFormat(msg);
    console.log("[Send] msg: %s", msgStr);
    serverSocket.send(msgStr, 0, msgStr.length, port, ip);
}

startService();

