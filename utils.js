/**
 * 工具类
 */
const crypto = require('crypto');

module.exports = {

    isObject (obj) {
        return obj && Object.prototype.toString.apply(obj) === '[object Object]';
    },

    /**
     * 报文格式组装
     * 接口要求data字段需要单独做一次JSON.stringify
     * */
    messageFormat (msg) {
        try {
            var msgData = Object.assign({},msg);
            if (this.isObject(msgData.data)) {
                msgData.data = JSON.stringify(msgData.data);
            }
            return JSON.stringify(msgData);
        } catch (e) {
            console.error('[messageFormat] Bad msg!', msg);
            return '{}';
        }
    },

    /**
     * AES-CBC 128加密
     * 用户收到“heartbeat”里的16个字节的“token”字符串之后，对该字符串进行AES-CBC 128加密，
     * 生成16个字节的密文后，再转换为32个字节的ASCII码字符串。
     *
     * @param token 网关的token，随网关心跳包下发更新
     * @param password 网关加密密码，在米家APP获取
     * @param iv 初始化向量，米家约定，外部配置
     * */
    cipher (token, password, iv) {
        var cipher = crypto.createCipheriv('aes-128-cbc', password, iv);
        var key = cipher.update(token, "ascii", "hex");
        cipher.final('hex');
        return key;
    }
};
