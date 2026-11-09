# 插件预览图

收录表单的「插件实际效果」用于提交 1–6 张真实截图及说明。维护者确认图片对应当前插件、没有密钥或个人信息后，在独立的 `data/plugin-previews.json` 中按包名登记：

```json
{
  "schema": 1,
  "plugins": {
    "example-plugin": {
      "screenshots": [
        {"url": "https://raw.githubusercontent.com/owner/repo/COMMIT/docs/screenshot.png", "alt": "插件在侧栏中显示任务列表"}
      ]
    }
  }
}
```

支持 GitHub 公共附件和公开仓库中的 PNG、JPEG、WebP、GIF。仓库图片优先使用固定提交地址。构建时校验后只写入网站的 `display.json`，不放入收录配置、包审核证据或 DSH 官方 `index.json`。图片发生变化后需重新确认。

未设置 `screenshots` 时，客户端从 README 的截图、演示或预览段落中识别图片，并排除 Logo、徽章、边框、横幅、小图和极宽装饰图。自动识别仍可能有误，可设置 `"screenshots": []` 明确关闭该插件的自动预览。

客户端优先请求 Raw README，以减少 GitHub API 限流；失败后尝试 GitHub 内容接口。更新说明只显示所选精确版本，依次检查匹配的 Release、包目录或根目录的 CHANGELOG，以及固定 Git 来源的提交比较。远程 Markdown 按文本展示。

截图来源会在详情页注明。图片读取失败、GitHub 限流和作者没有提供图片分别显示，详情保留原文入口。图片和元数据请求不携带浏览器凭据。
