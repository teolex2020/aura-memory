@echo off
rem E40 end to end, detached from the agent's background time limit.
cd /d D:\AuraSDK-public\experiments\value_net_transfer
set PYTHONIOENCODING=utf-8
D:\Aura-clean\.venv\Scripts\python.exe run.py embed >> embed.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
D:\Aura-clean\.venv\Scripts\python.exe run.py run > run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
D:\Aura-clean\.venv\Scripts\python.exe run.py analyze >> run.log 2>&1
echo EXIT %errorlevel% >> run.log
