const _ = require("./i18n");
const http = require('node:http');
const https = require('node:https');
const url = require('url');
const { Buffer } = require('node:buffer');
const { createClient, Platform, segment, Friend } = require("oicq");
const log4js = require('log4js');
const { MatrixUser, RemoteUser, MatrixRoom, RemoteRoom } = require("matrix-appservice-bridge");
let logger = log4js.getLogger('oicq');

exports.init = async function (config) {
    const account = config.account;
    const owner = config.owner;

    const client = createClient(account, { platform: Platform.iPad });
    exports.client = client;
    let matrixBridge;
    let matrixClient;

    client.on("system.online", async function () {
        // 你的账号已上线，你可以做任何事
        logger.info(_('online: %s(%s), 加载了%s个好友, %s个群, %s个陌生人', this.nickname, this.uin, this.fl.size, this.gl.size, this.sl.size));
        let userBridgeStore = matrixBridge.getUserStore();

        // 根据oicq信息获取matrix用户
        let matrixUsers = await userBridgeStore.getMatrixUsersFromRemoteId(account);
        if (matrixUsers.length == 0) {
            await userBridgeStore.linkUsers(
                new MatrixUser(matrixBridge.botUserId),
                new RemoteUser(account, { from: owner }));
        }
    });
    client.on("sync.message", async function () {
        logger.warn('sync.message: TODO:' + this);
    });
    client.on("sync.read", async function () {
        logger.warn('sync.read: TODO:' + this);
    });

    // 撤回和发送群消息
    client.on("message.group", function (msg) {
        if (msg.raw_message === "dice") {
            // 撤回这条消息
            msg.recall();
            // 发送一个骰子
            msg.group.sendMsg(segment.dice());
            // 发送一个戳一戳
            msg.member.poke();
        }
    });

    // 接收戳一戳
    client.on("notice.group.poke", function (e) {

        e.group.sendMsg(_("dont poke me"));
    });

    client.once("system.login.qrcode", function (event) {
        logger.warn(_('token login failed.'));
    }).login();

    // m.text, m.image, m.audio, m.video, m.location, m.emote
    function sendMessageToMatrix(event, intent, roomId) {
        let html = '';
        event.message.forEach(async message => {
            logger.debug(message);

            // 回复text
            //{ type: 'text', text: '1' }
            //event.reply('hello world',true);// true:引用
            if (message.type == "text") {
                html += `<span>${html_encode(message.text)}</span>`;
            }


            // 回复图片
            //{
            //   type: 'image',
            //   file: '1c4009d21000675004dec3100940f436370850-1080-2400.jpg',
            //   url: 'https://c2cpicdw.qpic.cn/offpic_new/147258369//147258369-369258147-004BC9D00360075024DEC319A940F436/0?term=3',
            //   asface: false
            // }
            // event.reply(segment.image("https://sqimg.qq.com/qq_product_operations/im/qqlogo/imlogo.png"));
            if (message.type == "image") {
                //TODO: 生成预览图
                let regExp = /([0-9a-f]+)-([0-9a-f]+)-([0-9a-f]+)/gi;
                let fileinfo = regExp.exec(message.file);
                intent.sendMessage(roomId, {
                    body: message.file,
                    url: await intent.uploadContent(await http_get(message.url), { name: message.file }),
                    info: {
                        w: fileinfo[2],
                        h: fileinfo[3],
                    },
                    msgtype: 'm.image',
                    oicq_message_id: event.message_id,
                });
            }

            // 回复表情
            //{ type: 'face', id: 178, text: '斜眼笑' }
            // message: [
            //     { type: 'face', id: 15, text: '难过' },
            //     { type: 'face', id: 16, text: '酷' },
            //     { type: 'face', id: 96, text: '冷汗' }
            //   ]
            // event.reply([
            //     segment.face(101),
            //     segment.face(102),
            //     segment.face(178),//斜眼笑
            //     "\ntwo faces"
            // ]);
            if (message.type == "face") {
                html += `<span>[${html_encode(message.text)}]</span>`;
            }

        });
        intent.sendMessage(roomId, {
            body: event.raw_message,
            format: "org.matrix.custom.html",
            formatted_body: html,
            msgtype: 'm.text',
            oicq_message_id: event.message_id,
        });
    }

    exports.system_login_qrcode = async function (event) {
        // roomEntries 可能不唯一
        let roomEntries = await matrixBridge.getRoomStore().getEntriesByRemoteId('oicqbot');
        logger.debug('roomEntries: ', roomEntries);
        if (roomEntries.length != 0) {
            roomEntries.forEach(async room => {

                matrixClient.sendMessage(room.matrix.roomId, {
                    body: `oicq_${account}_${Date.now()}`,
                    url: await matrixClient.uploadContent(event.image, { name: `oicq_${account}` }),
                    info: {
                        w: 135,
                        h: 135,
                    },
                    msgtype: 'm.image',
                });
            });
        }
        //on("internal.qrcode", qrcodeListener)

        let finished = false;
        do {
            client.queryQrcodeResult().then(function (params) {
                switch (params.retcode) {
                    case 0:
                        //已完成确认
                        client.login();
                        finished = true;
                        break;
                    case 17:
                        //二维码超时，请重新获取
                        if (roomEntries.length != 0) {
                            roomEntries.forEach(async room =>
                                matrixClient.sendText(room.matrix.roomId, _('二维码超时，请重新获取'))
                            );
                        }
                        finished = true;
                        break;
                    case 48:
                        //二维码尚未扫描
                        break;
                    case 53:
                        //二维码尚未确认
                        break;
                    case 54:
                        //二维码被取消，请重新获取
                        if (roomEntries.length != 0) {
                            roomEntries.forEach(async room =>
                                matrixClient.sendText(room.matrix.roomId, _('二维码被取消，请重新获取'))
                            );
                        }
                        finished = true;
                        break;
                    case -1:
                        //已完成扫描
                        finished = true;
                        break;
                }
                logger.debug(params);
            });
            logger.info(_('waiting in 5s.'));
            await new Promise(res => setTimeout(res, 5000));
        } while (!finished);
    }




    exports.setMatrixBridge = async function (bridge) {
        matrixBridge = bridge;
        matrixClient = matrixBridge.getBot().getClient();
    }

    exports.setupCallbacks = async function (config) {
        client.on("message", async event => {
            logger.info(event);

            let userBridgeStore = matrixBridge.getUserStore();
            let roomBridgeStore = matrixBridge.getRoomStore();

            if (event.message_type == 'private') {
                // 根据oicq信息获取matrix用户
                let matrixUsers = await userBridgeStore.getMatrixUsersFromRemoteId(event.sender.user_id);
                if (matrixUsers.length == 0) {
                    await userBridgeStore.linkUsers(
                        new MatrixUser(`@oicq_${event.sender.user_id}:${config.domain}`),
                        new RemoteUser(event.sender.user_id, { from: owner }));
                    matrixUsers = await userBridgeStore.getMatrixUsersFromRemoteId(event.sender.user_id);
                }

                // matrixUser 唯一
                logger.debug(matrixUsers);
                matrixUsers = matrixUsers[0];

                let intent = matrixBridge.getIntent(matrixUsers.userId);
                intent.setDisplayName(event.sender.nickname);
                // TODO: 上传头像并更改
                intent.setAvatarUrl(buildAvatarUrl(event.sender.user_id));

                // roomEntries 可能不唯一
                let roomEntries = await roomBridgeStore.getEntriesByRemoteId(matrixUsers.userId);
                logger.debug('roomEntries: ', roomEntries);
                if (roomEntries.length == 0) {
                    event.reply(_('[oicq] waiting for matrix'), true);
                    let room = await intent.createRoom({ createAsClient: true, options: { invite: [owner] } });
                    logger.debug('create room: ', room);

                    //type:private|group|?
                    matrixBridge.getRoomStore().linkRooms(new MatrixRoom(room.room_id), new RemoteRoom(matrixUsers.userId), { from: owner, type: event.message_type });


                    sendMessageToMatrix(event, intent, room.room_id);
                } else {
                    roomEntries.forEach(async room => {

                        sendMessageToMatrix(event, intent, room.matrix.roomId);
                    });
                }

                // 已读(当前时间以前)
                event.friend.markRead();
                return;
            }

            if (event.message_type == 'group') {
                // 根据oicq信息获取matrix用户
                let matrixUsers = await userBridgeStore.getMatrixUsersFromRemoteId(event.sender.user_id);
                if (matrixUsers.length == 0) {
                    await userBridgeStore.linkUsers(
                        new MatrixUser(`@oicq_${event.sender.user_id}:${config.domain}`),
                        new RemoteUser(event.sender.user_id, { from: owner }));
                    matrixUsers = await userBridgeStore.getMatrixUsersFromRemoteId(event.sender.user_id);
                }

                // matrixUser 唯一
                logger.debug(matrixUsers);
                matrixUsers = matrixUsers[0];

                let intent = matrixBridge.getIntent(matrixUsers.userId);
                intent.setDisplayName(event.sender.nickname);
                // TODO: 上传头像并更改
                intent.setAvatarUrl(buildAvatarUrl(event.sender.user_id));

                // roomEntries 可能不唯一
                let roomEntries = await roomBridgeStore.getEntriesByRemoteId(event.group_id);
                logger.debug('roomEntries: ', roomEntries);
                if (roomEntries.length == 0) {
                    event.reply(_('[oicq] waiting for matrix'), true);
                    let room = await intent.createRoom({ options: { invite: [owner, matrixUsers.userId] } });
                    logger.debug('create room: ', room);

                    //type:private|group|?
                    matrixBridge.getRoomStore().linkRooms(new MatrixRoom(room.room_id), new RemoteRoom(event.group_id), { from: owner, type: event.message_type });
                    // set room displayname
                    matrixClient.sendStateEvent(room.room_id, 'm.room.name', null, event.group_name);

                    sendMessageToMatrix(event, intent, room.room_id);
                } else {
                    roomEntries.forEach(async room => {
                        // set room displayname
                        matrixClient.sendStateEvent(room.matrix.roomId, 'm.room.name', '', { name: event.group_name });

                        sendMessageToMatrix(event, intent, room.matrix.roomId);
                    });
                }



                // 已读(当前时间以前)
                event.group.markRead();
                return;
            }
        });
    }

    // m.text, m.image, m.audio, m.video, m.location, m.emote
    exports.sendMessage = async function (target, method, content) {
        logger.debug('sendMessage');
        let msg, url;

        // Build oicq message from matrix message.
        switch (content.msgtype) {
            case "m.text":
                msg = content.body;
                break;
            case "m.image":
                url = matrixClient.mxcToHttp(content.url);
                console.log(url);
                msg = segment.image(url);
                break;
            case "sticker":
                //TODO: sticker?
                /* Will come to use, if OICQ has an option to send image asface */
                break;
            case "video":
                //TODO: m.video
                /* Videos should be downloaded locally after sending it. */
                // msg = segment.video(content.url);
                break;
            case "audio":
                //TODO: m.audio
                url = matrixClient.mxcToHttp(content.url);
                msg = segment.record(url);
                break;
            case "m.file":
                //TODO: group file
                url = matrixClient.mxcToHttp(content.url);
                if (method == "private") {
                    let buffer = await http_get(url);

                    client.pickFriend(target).sendFile(buffer, content.body);
                }
                if (method == "group") {
                    let buffer = await http_get(url);

                    client.pickGroup(target).sendFile(buffer, content.body);
                }
                return;
            case "m.location":
                //TODO: location
                /* As this hasn't impliied by mx-puppet-bridge, we will leave it here. */
                // msg = segment.location(content.lat, content.lng, content.addr);
                break;
        }

        if (msg == null) {
            logger.warn(_('msg == null'));
            return;
        }
        logger.debug({ url: url, msg: msg });

        try {


            // Send oicq message by some ways.
            switch (method) {
                case "private":
                    return client.sendPrivateMsg(target, msg);
                case "temp":
                    //TODO: temp message
                    return client.sendTempMsg(
                        groupCache.get(target),
                        target,
                        msg
                    );
                case "group":
                    return client.sendGroupMsg(target, msg);
            }
        } catch (e) {
            logger.error(e);
        }
        return;
    }
}


function buildAvatarUrl(id) {
    return `https://q1.qlogo.cn/g?b=qq&s=100&nk=${id}`;
}

function buildGroupAvatarUrl(id) {
    return `https://p.qlogo.cn/gh/${id}/${id}/100`;
}

function html_encode(str) {
    var s = '';
    if (str.length === 0) {
        return '';
    }
    s = str.replace(/&/g, '&amp;');
    s = s.replace(/</g, '&lt;');
    s = s.replace(/>/g, '&gt;');
    s = s.replace(/ /g, '&nbsp;');
    s = s.replace(/\'/g, '&#39;');
    s = s.replace(/\"/g, '&quot;');
    return s;
}

async function http_get(request_url) {
    return new Promise((resolve, reject) => {
        let buffer = Buffer.alloc(0);

        let urlObject = url.parse(request_url);

        let h;
        if (urlObject.protocol == 'http:') {
            h = http;
        } else if (urlObject.protocol == 'https:') {
            h = https;
        } else {
            reject('unknown url protocol');
        }

        h.get(request_url, (res) => {
            res.on('data', (d) => {
                buffer = Buffer.concat([buffer, d])
            });
            res.on('end', () => {
                resolve(buffer);
            });

        }).on('error', (e) => {
            reject(e);
        });

    });
}