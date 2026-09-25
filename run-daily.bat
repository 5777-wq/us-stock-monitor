@echo off
rem 美股监控 · 每日定时入口（Task Scheduler 调这个文件）
rem 输出追加到 out\run.log，报告在 out\report.html
chcp 65001 >nul
cd /d "%~dp0"
if not exist out mkdir out
node monitor.mjs --quiet >> out\run.log 2>&1
