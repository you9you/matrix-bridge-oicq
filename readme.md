# matrix-bridge-oicq


```bash
# 配置文件
cp configure.simple.yaml configure.yaml
vim configure.yaml

# 安装依赖
npm install
# 生成appservice配置文件(matrix-bridge-oicq URL)
npm start -- -r -u 'http://localhost:8090'
```

添加到homeserver.yaml的app_service_config_files

```yml
app_service_config_files:
  - "oicq-registration.yaml"
```

```bash
# 运行
npm start
```



TODO
- [ ] bot头像
- [x] 用户名称
- [ ] 用户头像
- [ ] 群组消息
- [x] 群组名称
- [ ] 群组头像
- [ ] video
- [ ] audio
- [ ] Dockerfile
- [ ] readme.md
- [ ] oicq.client.getFriendList()缓存并显示remark


MPL-2.0 license
https://github.com/takayama-lily/oicq

Apache-2.0 license 
https://github.com/matrix-org/matrix-appservice-bridge


参考
https://github.com/matrix-org/matrix-appservice-discord/
https://github.com/goodspeed34/mx-puppet-oicq/
https://github.com/mymindstorm/matrix-appservice-mumble/
https://github.com/abbyck/matrix-appservice-email/
