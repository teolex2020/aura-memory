@echo off
rem E41 end to end, detached from the agent's background time limit.
cd /d D:\AuraSDK-public\experiments\value_signals
set PYTHONIOENCODING=utf-8
D:\Aura-clean\.venv\Scripts\python.exe run.py surprisal > run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
D:\Aura-clean\.venv\Scripts\python.exe run.py judge >> run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
D:\Aura-clean\.venv\Scripts\python.exe run.py analyze >> run.log 2>&1
echo EXIT %errorlevel% >> run.log
