# 拒绝访问时，响应头也需要保护信息

工作台拒绝一个请求后，浏览器仍然会接收并处理响应。稿栈把安全响应头放进公共配置，用于 API JSON、页面资源和认证失败响应。它们覆盖的是不同的数据流向。

Cache-Control 的 no-store 要求缓存不要存储响应。Referrer-Policy 的 no-referrer 避免从页面跳转时传递来源网址。X-Frame-Options 的 DENY 与内容安全策略中的 frame-ancestors 限制页面被嵌入其他站点。摄像头、麦克风和定位也通过权限策略默认关闭。

## 复现

运行 `node --test tests/publication.test.mjs`，查看 `requires deployment settings and authenticates requests before touching storage`。测试检查认证失败响应仍带 no-store 和 DENY。可对照 worker.mjs 中的 privateHeaders，查看其他响应头的配置。该测试直接调用请求处理函数，未模拟浏览器缓存或嵌入页面。

响应头需要在部署后实际送达浏览器。若前置代理覆盖它们，源代码里的声明就不足以描述最终行为。检查线上环境时，应从浏览器网络面板或 HTTP 客户端读取响应，和服务端配置逐项比较。
