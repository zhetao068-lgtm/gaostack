# 稿栈 GaoStack

[中文](#中文) | [English](#english)

## 中文

**给公众号编辑的私有稿件工作台。** 手机和电脑都能写稿、换封面、预览正文。接入有发布权限的公众号后，可逐篇提交并查微信回执。

- 支持导入 TXT、Markdown 和 JSON，校验长文拆分前后是否一致。
- 通过官方公众号接口逐篇发布，保存提交编号和公开链接。图文所需权限以账号后台为准。
- 账号密钥仅在服务端使用，稿件库仅供部署者访问。发表默认关闭，启用后也需要逐篇确认。

**喜欢稿栈？** [了解如何支持项目](docs/support.md)。

## 运行和部署

1. 安装 Node.js 22.13 或更新版本，运行 `npm run build` 和 `npm test`。
2. 用 Cloudflare Workers 绑定一个新的 D1 数据库。复制 `wrangler.example.toml` 为 `wrangler.toml`，填写数据库 ID 和你控制的 HTTPS 域名，设置该域名的 Worker 路由。将该文件留在本机。
3. 通过部署端的密钥管理设置 `ACCESS_PASSWORD`。使用密码管理器生成 32 字符或更长的高熵密码，允许字符为字母、数字、下划线和连字符。浏览器弹出登录时，用户名填写 `editor`。
4. 使用 Wrangler 为该数据库应用 `drizzle/` 中的迁移并部署构建产物。在公开网络使用时，请给登录失败流量设置边缘限速，团队使用时在外层部署身份网关。
5. 需要发表时，再配置服务端密钥 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，将 `ENABLE_PUBLISH` 改为 `true` 并部署。先核对公众号接口权限和服务端 IP 白名单。发布中的稿件请通过回执查询核对。

前端和接口都需要访问密码。运行时没有统计代码、追踪脚本或外部字体。正文与图片保存在部署者的数据库内。下载稿件会在访问者设备上产生本地副本。

## 技术文章

- [一次点击，如何避免发两次](docs/01-publish-once.md)
- [公开代码，为什么还需要锁住工作台](docs/02-private-runtime.md)
- [长文拆分如何保留每个字符](docs/03-lossless-splitting.md)
- [为什么请求体上限要按字节算](docs/04-request-byte-limits.md)
- [封面上传前，浏览器做了什么](docs/05-cover-processing.md)
- [纯文本稿件如何转换成微信图文](docs/06-plain-text-to-wechat.md)

这些是基于仓库实现和本地测试的工程文章。安全边界与部署注意事项见 [SECURITY.md](SECURITY.md)。

## English

**GaoStack is a self-hosted editorial workspace for WeChat Official Accounts.** Write and preview articles, add covers, and check publication results from a phone or computer.

- Import plain text, Markdown, or JSON. Split long articles without losing any text.
- Submit articles individually through the official WeChat API. Track the submission ID and retrieve the public article link after WeChat confirms publication.
- Keep drafts behind HTTPS and password authentication. WeChat credentials stay on the server, and publishing is disabled by default.

**Find GaoStack useful?** [Support the project](docs/support.md).

### Build and deploy

1. Install Node.js 22.13 or newer. Run `npm run build` and `npm test`.
2. Create a Cloudflare D1 database for the Worker. Copy `wrangler.example.toml` to `wrangler.toml`, enter the database ID and an HTTPS domain you control, and configure the Worker route. Keep your populated configuration out of version control.
3. Set the `ACCESS_PASSWORD` deployment secret to a strong, randomly generated password of at least 32 characters. Use letters, numbers, hyphens, or underscores. In the browser sign-in prompt, enter `editor` as the username.
4. Apply the migrations in `drizzle/` with Wrangler and deploy the build. Rate-limit failed sign-ins at the edge. For a team deployment, use an identity gateway.
5. To enable publication, set the server secrets `WECHAT_APP_ID` and `WECHAT_APP_SECRET`, set `ENABLE_PUBLISH` to `true`, and redeploy. Check the account's API permissions and server IP allowlist in WeChat first. Each article still requires confirmation.

The interface and API both require authentication. GaoStack does not load analytics, trackers, or external fonts. Drafts and covers are stored in your database. Downloaded drafts are saved on the visitor's device.

### Engineering notes

The notes below are currently written in Chinese:

- [How GaoStack prevents duplicate submissions](docs/01-publish-once.md)
- [Why a public repository still needs a private workspace](docs/02-private-runtime.md)
- [How splitting preserves the original text](docs/03-lossless-splitting.md)
- [Why request size limits use bytes](docs/04-request-byte-limits.md)
- [How the browser processes cover images](docs/05-cover-processing.md)
- [How plain text becomes a WeChat article](docs/06-plain-text-to-wechat.md)

See [SECURITY.md](SECURITY.md) for deployment safeguards and reporting security issues.
