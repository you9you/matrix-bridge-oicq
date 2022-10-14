const _ = require("./i18n");
const fs = require("node:fs");
const log4js = require('log4js');
const yaml = require('js-yaml');
const { Cli, ConfigValidator, Bridge, AppServiceRegistration, MatrixRoom, RemoteRoom, Logger } = require("matrix-appservice-bridge");

let loggerLevel = 'WARN';
if (process.argv.indexOf('--debug') != -1) {
    loggerLevel = 'DEBUG';
    Logger.configure({ level: "debug" });
}

log4js.configure({
    appenders: {
        console: {
            type: "console",
            layout: {
                type: 'pattern',
                pattern: '%[[%d] [%p] [%f{2}:%l] %m'
            }
        }
    },
    categories: {
        default: { appenders: ["console"], level: loggerLevel, enableCallStack: true },
        configure: { appenders: ["console"], level: loggerLevel, enableCallStack: true },
        oicq: { appenders: ["console"], level: loggerLevel, enableCallStack: true },
    },
});

const oicq = require("./oicq");

// TODO:/data/configure.yaml
let configure = yaml.load(fs.readFileSync('configure.yaml', 'utf8'));
// check configure
{
    let logger = log4js.getLogger('configure');

    let check = function (field) {
        if (configure[field] == null) {
            // log warn
            logger.error('not found: %s', field);
            process.exit(1);
        }
    }

    check('registration');
    check('homeserverUrl');
    check('domain');
    check('account');
    check('owner');

    //TODO: ConfigValidator
    // Provides a way to validate a YAML file when provided with a schema file. Useful for setting your bridge-specific configuration information.
    logger.debug(configure);
}
oicq.init(configure);

// let configValidator =ConfigValidator.fromSchemaFile('configure.yaml');
// let configure =configValidator.validate();

let bridge;

// MODULE_NOT_FOUND
// https://github.com/matrix-org/matrix-rust-sdk/releases


async function runBridge() {
    let logger = log4js.getLogger('bridge');
    bridge = new Bridge({
        homeserverUrl: configure.homeserverUrl,//TODO: configure
        domain: configure.domain,//TODO: configure
        registration: configure.registration,

        controller: {
            onUserQuery: function (queriedUser) {
                logger.debug('onUserQuery');
                return {}; // auto-provision users with no additonal data
            },
            onEvent: async function (request, context) {
                const event = request.getData();
                logger.debug('onEvent', event);

                try {
                    // invite
                    if (event.type == "m.room.member" &&
                        event.content &&
                        event.content.membership == "invite"
                    ) {
                        // await bridge.getBot().getClient().joinRoom(event.room_id);
                        // await bridge.getBot().getClient().sendText(event.room_id, 'hello');
                        let intent = bridge.getIntent(event.state_key);
                        await intent.join(event.room_id);
                        await bridge.getRoomStore().linkRooms(new MatrixRoom(event.room_id), new RemoteRoom(event.state_key));
                        if (event.state_key == bridge.botUserId) {
                            await intent.setDisplayName('oicq bot');
                            await intent.sendText(event.room_id, 'hello');
                        }
                        return;
                    }

                    let roomEntries = await bridge.getRoomStore().getEntriesByMatrixId(event.room_id);
                    roomEntries.forEach(async roomEntry => {
                        let userId = roomEntry.remote.roomId;
                        // oicq bot
                        if (userId == 'oicqbot' && event.type == "m.room.message") {
                            let content = event.content;

                            if (content.msgtype && content.msgtype == 'm.text' && content.body) {
                                if (content.body == '!help') {
                                    bridge.getBot().getClient().replyText(event.room_id, event, 'help: TODO');
                                    return;
                                }
                                if (content.body == '!login') {
                                    // TODO: test qrlogin
                                    bridge.getBot().getClient().replyText(event.room_id, event, 'login: TODO');
                                    oicq.client.once("system.login.qrcode", oicq.system_login_qrcode).login();
                                    return;
                                }
                                if (content.body == '!getFriendList') {
                                    bridge.getBot().getClient().replyText(event.room_id, event, JSON.stringify(oicq.client.getFriendList()));
                                    console.log(oicq.client.getFriendList());
                                    return;
                                }
                                if (content.body == '!getGroupList') {
                                    bridge.getBot().getClient().replyText(event.room_id, event, JSON.stringify(oicq.client.getGroupList()));
                                    console.log(oicq.client.getGroupList());
                                    return;
                                }
                                if (content.body == '!logout') {
                                    bridge.getBot().getClient().replyText(event.room_id, event, 'logout: TODO');
                                    // TODO: unlinkRooms..
                                    // TODO: unlinkUsers..(getByRemoteData({from: owner}))
                                    // TODO: botClient.resolveRoom
                                    oicq.client.logout();
                                    return;
                                }

                            }
                            bridge.getBot().getClient().replyText(event.room_id, event, 'usage: !help');
                            return;
                        }

                    });


                    // 木偶用户
                    if (event.type === "m.room.message" || event.type === "m.sticker") {
                        // if (remoteRoom) {
                        //     await this.ProcessMsgEvent(event, remoteRoom.remote);
                        // }
                        //TODO
                        roomEntries.forEach(async roomEntry => {
                            let matrixId = roomEntry.remote.roomId;
                            logger.debug(roomEntry);


                            if (roomEntry.data.type == 'private') {
                                let remoteUsers = await bridge.getUserStore().getRemoteUsersFromMatrixId(matrixId);
                                logger.debug(remoteUsers);
                                remoteUsers.forEach(async remoteUser => {
                                    logger.debug(await oicq.sendMessage(remoteUser.id, roomEntry.data.type, event.content));
                                });
                                return;
                            }
                            if (roomEntry.data.type == 'group') {
                                logger.debug(await oicq.sendMessage(matrixId, roomEntry.data.type, event.content));
                                return;
                            }

                        });
                        return;
                    } else if (event.type === "m.room.encryption" && roomEntries.length > 0) {
                        logger.info(_('User has turned on encryption in %s, so leaving.', event.room_id));
                        /* N.B 'status' is not specced but https://github.com/matrix-org/matrix-doc/pull/828
                         has been open for over a year with no resolution. */
                        const sendPromise = bridge.getBot().getClient().sendEvent(event.room_id, {
                            body: _('You have turned on encryption in this room, so the service will not bridge any new messages.'),
                            msgtype: "m.notice",
                            status: "critical",
                        });

                        await sendPromise;
                        await bridge.getBot().getClient().leaveRoom(event.room_id);
                        await bridge.getRoomStore().removeEntriesByMatrixRoomId(event.room_id)
                        return;
                    }
                    logger.debug({
                        user: event.sender,
                        text: event.content.body
                    });
                } catch (e) {
                    logger.error('onEvent', event);
                    logger.error(e);
                }
            }
        }
    });


    await bridge.initalise();
    await oicq.setMatrixBridge(bridge);
    await oicq.setupCallbacks(configure);
    await bridge.listen(configure.port);

    bridge.appService.expressApp.get("/health", (_, res) => {
        //TODO:docker
        res.status(200).send("");
    });

    logger.info(_('Matrix-side listening on port %s', configure.port));
    process.on('SIGINT', async () => {
        // Handle Ctrl-C
        logger.info(_(`Closing bridge due to SIGINT`));
        try {
            await bridge.appService.close();
            process.exit(0);
        }
        catch (e) {
            log.error(_(`Ungraceful shutdown:`), e);
            process.exit(1);
        }
    });
}

try {
    fs.accessSync(configure.registration);
} catch (e) {
    let logger = log4js.getLogger('index');
    if (e) {
        fs.appendFileSync(configure.registration, '', 'utf-8', (e) => {
            if (e) {
                logger.error(('%s不存在, 创建失败', configure.registration));
            }
            logger.info(('%s不存在, 已创建', configure.registration));
        });
    }
}


new Cli({
    registrationPath: configure.registration,
    generateRegistration: function (reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("oicqbot");
        reg.addRegexPattern("users", "@oicq_.*", true);
        callback(reg);
    },
    run: function (port) {
        runBridge(port || configure.port || 8090);
    }
}).run();