"""메일 발송 서비스 - Windows Outlook/SMTP 연동"""
import smtplib
import subprocess
import json
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import Optional


def send_via_smtp(
    smtp_host: str,
    smtp_port: int,
    username: str,
    password: str,
    sender: str,
    recipients: list,
    subject: str,
    body: str,
    attachments: Optional[list] = None,
    use_tls: bool = True,
) -> dict:
    """SMTP를 통한 이메일 발송"""
    try:
        msg = MIMEMultipart()
        msg["From"] = sender
        msg["To"] = ", ".join(recipients)
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain", "utf-8"))

        if attachments:
            for att in attachments:
                part = MIMEBase("application", "octet-stream")
                part.set_payload(att["content"])
                encoders.encode_base64(part)
                part.add_header(
                    "Content-Disposition",
                    f"attachment; filename=\"{att['filename']}\"",
                )
                msg.attach(part)

        if use_tls:
            server = smtplib.SMTP(smtp_host, smtp_port)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(smtp_host, smtp_port)

        server.login(username, password)
        server.sendmail(sender, recipients, msg.as_string())
        server.quit()
        return {"success": True, "message": f"{len(recipients)}명에게 발송 완료"}
    except Exception as e:
        return {"success": False, "message": str(e)}


def send_via_outlook(recipients: list, subject: str, body: str) -> dict:
    """Windows Outlook COM 자동화를 통한 발송 (초안만 생성)"""
    ps_script = f"""
$outlook = New-Object -ComObject Outlook.Application
$mail = $outlook.CreateItem(0)
$mail.Subject = "{subject.replace('"', "'")}"
$mail.Body = @"
{body.replace('"', "'")}
"@
$mail.To = "{'; '.join(recipients)}"
$mail.Display()
"""
    try:
        result = subprocess.run(
            ["powershell", "-Command", ps_script],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode == 0:
            return {"success": True, "message": "Outlook 초안 생성 완료 (직접 검토 후 발송)"}
        return {"success": False, "message": result.stderr}
    except Exception as e:
        return {"success": False, "message": str(e)}


def parse_email_text(ai_text: str) -> tuple[str, str]:
    """AI가 생성한 이메일 텍스트에서 제목과 본문을 분리"""
    lines = ai_text.strip().split("\n")
    subject = ""
    body_lines = []
    found_subject = False
    for line in lines:
        if line.lower().startswith("subject:") and not found_subject:
            subject = line.split(":", 1)[1].strip()
            found_subject = True
        elif line.lower().startswith("제목:") and not found_subject:
            subject = line.split(":", 1)[1].strip()
            found_subject = True
        else:
            body_lines.append(line)
    body = "\n".join(body_lines).strip()
    if not subject:
        subject = "BOM 변경 알림"
    return subject, body
