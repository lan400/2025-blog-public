

git 使用规范 

每次搞新东西前
# 1. 先拉取远端最新代码
git pull origin main

# 2. 创建新分支进行开发
git checkout -b feature/your-feature

# 3. 写代码、测试...

# 4. 提交并推送到远端
git add .
git commit -m "添加新功能"
git push origin feature/your-feature

React + TS：如果拉取后运行 npm start报错，检查 package.json依赖是否更新。远端可能新增了依赖，你需要运行：npm install

Tailwind CSS：确保 tailwind.config.js等配置文件也同步更新，类名变更可能导致样式失效。
GitHub API：如果远端改了 API 调用方式（如换了接口、Token 逻辑），你的本地代码调用方式也需要对应更新。