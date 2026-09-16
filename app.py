import os
import json
import base64
from datetime import date, timedelta, datetime
from flask import Flask, render_template, request, jsonify, redirect, url_for

from octodiary.apis.sync import SyncMobileAPI
from octodiary.types.captcha import Captcha
from octodiary.types.enter_sms_code import EnterSmsCode

app = Flask(__name__)
app.secret_key = os.urandom(24)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
TOKEN_FILE = os.path.join(DATA_DIR, "session.json")

os.makedirs(DATA_DIR, exist_ok=True)

_api: SyncMobileAPI | None = None
_pending_captcha: Captcha | None = None
_pending_sms: EnterSmsCode | None = None


def get_api() -> SyncMobileAPI:
    global _api
    if _api is None:
        _api = SyncMobileAPI()
    return _api


def load_session() -> dict | None:
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE) as f:
            return json.load(f)
    return None


def save_session(token: str, profile_id: int, student_id: int, person_id: str, student_name: str):
    with open(TOKEN_FILE, "w") as f:
        json.dump({
            "token": token,
            "profile_id": profile_id,
            "student_id": student_id,
            "person_id": person_id,
            "student_name": student_name,
        }, f, indent=2, ensure_ascii=False)


def resolve_student(api: SyncMobileAPI) -> dict:
    """After login, figure out profile_id, student_id, person_id."""
    profiles = api.get_users_profile_info()
    if not profiles:
        raise ValueError("No profiles found")

    profile_id = profiles[0].id
    profile_type = profiles[0].type

    family = api.get_family_profile(profile_id)

    if family.children:
        child = family.children[0]
        student_id = child.id
        person_id = child.contingent_guid or ""
        name = f"{child.first_name} {child.last_name}"
    elif family.profile:
        student_id = family.profile.id
        person_id = ""
        name = f"{family.profile.first_name} {family.profile.last_name}"
    else:
        student_id = profile_id
        person_id = ""
        name = "Ученик"

    if person_id == "" and student_id:
        try:
            pd = api.get_person_data(person_id=str(student_id), profile_id=profile_id)
            if pd and pd.person_id:
                person_id = pd.person_id
        except Exception:
            pass

    return {
        "profile_id": profile_id,
        "student_id": student_id,
        "person_id": person_id,
        "student_name": name,
    }


def finish_login(api: SyncMobileAPI, token: str) -> dict:
    api.token = token
    info = resolve_student(api)
    save_session(token, **info)
    return {"status": "ok", "name": info["student_name"]}


def handle_auth_result(api, result):
    """Handle the polymorphic result from esia_login / captcha / sms."""
    global _pending_captcha, _pending_sms

    if isinstance(result, str):
        return jsonify(finish_login(api, result))

    if isinstance(result, Captcha):
        _pending_captcha = result
        if result.gosuslugi_type == "image_captcha":
            img_bytes = result.get_captcha_image()
            img_b64 = base64.b64encode(img_bytes).decode()
            return jsonify({"status": "captcha", "type": "image", "image": img_b64})
        else:
            question = result.get_question()
            return jsonify({"status": "captcha", "type": "question", "question": question})

    if isinstance(result, EnterSmsCode):
        _pending_sms = result
        return jsonify({
            "status": "sms",
            "contact": result.contact,
            "ttl": result.ttl,
            "attempts": result.remain_attempts,
        })

    if result is True:
        return jsonify(finish_login(api, api.token))

    return jsonify({"status": "error", "message": "Не удалось войти"}), 401


# ── Routes ──────────────────────────────────────────────────────

@app.route("/")
def index():
    sess = load_session()
    if not sess:
        return redirect(url_for("login_page"))
    return render_template("dashboard.html", name=sess["student_name"])


@app.route("/login")
def login_page():
    return render_template("login.html")


@app.route("/api/login", methods=["POST"])
def api_login():
    global _pending_captcha, _pending_sms
    _pending_captcha = None
    _pending_sms = None

    data = request.json
    api = get_api()

    try:
        result = api.esia_login(data["username"], data["password"])
        return handle_auth_result(api, result)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/captcha", methods=["POST"])
def api_captcha():
    global _pending_captcha
    if not _pending_captcha:
        return jsonify({"status": "error", "message": "No pending captcha"}), 400

    api = get_api()
    try:
        result = _pending_captcha.answer_captcha(request.json["answer"])
        _pending_captcha = None
        return handle_auth_result(api, result)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/sms", methods=["POST"])
def api_sms():
    global _pending_sms
    if not _pending_sms:
        return jsonify({"status": "error", "message": "No pending SMS"}), 400

    api = get_api()
    try:
        result = _pending_sms.enter_code(request.json["code"])
        _pending_sms = None
        return handle_auth_result(api, result)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/homework")
def api_homework():
    sess = load_session()
    if not sess:
        return jsonify({"error": "not authenticated"}), 401

    api = get_api()
    api.token = sess["token"]

    from_date = date.today()
    to_date = from_date + timedelta(days=7)

    try:
        hw = api.get_homeworks_short(
            student_id=sess["student_id"],
            profile_id=sess["profile_id"],
            from_date=from_date,
            to_date=to_date,
        )
        items = []
        if hw and hw.payload:
            for h in hw.payload:
                items.append({
                    "subject": h.subject_name,
                    "description": h.description,
                    "date": str(h.date)[:10] if h.date else None,
                    "is_done": h.is_done,
                    "type": h.type,
                })
        return jsonify(items)
    except Exception as e:
        if "401" in str(e) or "auth" in str(e).lower():
            return jsonify({"error": "token_expired"}), 401
        return jsonify({"error": str(e)}), 500


@app.route("/api/schedule")
def api_schedule():
    sess = load_session()
    if not sess:
        return jsonify({"error": "not authenticated"}), 401

    api = get_api()
    api.token = sess["token"]

    day = request.args.get("date", str(date.today()))
    target = datetime.strptime(day, "%Y-%m-%d").date()

    try:
        events = api.get_events(
            person_id=sess["person_id"],
            mes_role="student",
            begin_date=target,
            end_date=target + timedelta(days=1),
        )
        items = []
        if events and events.response:
            for ev in sorted(events.response, key=lambda e: str(e.start_at or "")):
                items.append({
                    "subject": ev.subject_name or ev.title or "",
                    "start": str(ev.start_at) if ev.start_at else None,
                    "end": str(ev.finish_at) if ev.finish_at else None,
                    "room": ev.room_number,
                    "teacher": ev.author_name,
                    "theme": ev.lesson_theme,
                    "homework": ev.homework.description if ev.homework and ev.homework.description else None,
                    "marks": [{"value": m.value, "weight": m.weight} for m in (ev.marks or [])],
                    "cancelled": ev.cancelled,
                })
        return jsonify(items)
    except Exception as e:
        if "401" in str(e) or "auth" in str(e).lower():
            return jsonify({"error": "token_expired"}), 401
        return jsonify({"error": str(e)}), 500


@app.route("/api/marks")
def api_marks():
    sess = load_session()
    if not sess:
        return jsonify({"error": "not authenticated"}), 401

    api = get_api()
    api.token = sess["token"]

    from_date = date.today() - timedelta(days=30)
    to_date = date.today()

    try:
        marks = api.get_marks(
            student_id=sess["student_id"],
            profile_id=sess["profile_id"],
            from_date=from_date,
            to_date=to_date,
        )
        items = []
        if marks and marks.payload:
            for m in marks.payload:
                items.append({
                    "value": m.value,
                    "subject": m.subject_name,
                    "date": str(m.date)[:10] if m.date else None,
                    "control_form": m.control_form_name,
                    "weight": m.weight,
                    "is_exam": m.is_exam,
                })
        return jsonify(items)
    except Exception as e:
        if "401" in str(e) or "auth" in str(e).lower():
            return jsonify({"error": "token_expired"}), 401
        return jsonify({"error": str(e)}), 500


@app.route("/api/logout", methods=["POST"])
def api_logout():
    global _api
    if os.path.exists(TOKEN_FILE):
        os.remove(TOKEN_FILE)
    _api = None
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    print(f"Goose School Sync -> http://127.0.0.1:{port}")
    app.run(host="127.0.0.1", port=port, debug=True)
