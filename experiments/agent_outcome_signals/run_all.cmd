@echo off
rem E45 end to end, detached from the agent's background time limit.
cd /d D:\AuraSDK-public\experiments\agent_outcome_signals
set PYTHONIOENCODING=utf-8
E:\remy\app\.venv\Scripts\python.exe run.py signals > run.log 2>&1
if errorlevel 1 (echo EXIT 1 >> run.log & exit /b 1)
E:\remy\app\.venv\Scripts\python.exe run.py analyze >> run.log 2>&1
echo EXIT %errorlevel% >> run.log
