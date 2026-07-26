# NeverCull

NeverCull 是一个完全离线的桌面照片初筛工具。首版支持 JPG、PNG 和 WebP，可检测曝光、模糊和重复照片，
并通过 XMP 与 CSV 交付人工复核结果。应用不会移动或删除原图。

## 开发

需要 Node.js 20+、Rust stable，以及 Tauri 2 对应的平台依赖。

```bash
npm install
npm run tauri dev
```

从仓库根目录也可运行：

```bash
npm run nevercull:dev
npm run nevercull:check
npm run nevercull:build
```

首次打开后选择照片目录。检测结果和人工标记存储在系统应用数据目录中的 `nevercull.sqlite`；只有用户确认
“导出 XMP + CSV”后，工具才会向照片目录写入 sidecar 和汇总文件。
