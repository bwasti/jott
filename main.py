from flask import Flask, render_template, request, g, abort
import sqlite3
import time

app = Flask(__name__)

# Singleton pattern (because threading)
def get_db(name):
    db = getattr(g, "_database_{}".format(name), None)
    db_list = getattr(g, "_db_list", [])
    if db is None:
        db = g._database = sqlite3.connect("{}.db".format(name))
        db_list.append(name)
    return db


def get_ip():
    ip_forward = request.headers.getlist("X-Forwarded-For")
    if ip_forward:
        return ip_forward[0]
    else:
        return request.remote_addr


@app.route("/")
def index():
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM notes")
    count = c.fetchone()[0]
    return render_template("index.html", count=count)


@app.route("/edit/note/")
@app.route("/edit/note/<name>")
def edit_note(name=None):
    name = name if name else ""
    note = ""
    if name:
        conn = get_db("notes")
        c = conn.cursor()
        c.execute("SELECT note FROM notes WHERE name=?", (name,))
        result = c.fetchone()
        note = result[0] if result else ""
    return render_template("edit.html", name=name, note=note)


@app.route("/save/note/<name>/", methods=["POST"])
@app.route("/save/note/<name>/<key>", methods=["POST"])
def save_note(name, key=""):
    if len(name) > 99 or len(name) < 1:
        return "Note name length must be between 1 and 100 characters\n", 403

    if len(key) > 99:
        return "Note key length must be under 100 characters\n", 403

    note = request.json["note"]
    if len(note) > 10000:
        return "Note length must be under 10K characters\n", 403

    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT key FROM notes WHERE name=?", (name,))

    saved_key = c.fetchone()
    if saved_key and saved_key[0] != key:
        return "Note already saved with different key\n", 403

    ip = get_ip()
    date = int(time.time())

    c.execute(
        """
    SELECT count, date FROM ips WHERE ip=?
    """,
        (ip,),
    )
    count_lookup = c.fetchone()

    if count_lookup:
        time_since = date - count_lookup[1]
        print(time_since)
        count = count_lookup[0] + 1
        if time_since < 10:
            return "Rate limit reached. Please try again later.\n", 403
    else:
        count = 1
        c.execute(
            """
        INSERT INTO ips VALUES (?, ?, ?)
        """,
            (ip, count, date),
        )

    c.execute(
        """
    UPDATE ips SET count=?, date=? WHERE ip=?
    """,
        (count, date, ip),
    )

    c.execute(
        """
    DELETE FROM notes WHERE name=?
    """,
        (name,),
    )

    c.execute(
        """
    INSERT INTO notes VALUES (?, ?, ?, ?, ?)
    """,
        (name, note, key, ip, date),
    )

    conn.commit()
    return 'Success! Note "{}" saved\n'.format(name)


@app.route("/delete/note/<name>/", methods=["GET"])
@app.route("/delete/note/<name>/<key>", methods=["GET"])
def delete_note(name, key=""):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT key FROM notes WHERE name=?", (name,))
    saved_key = c.fetchone()
    if saved_key and saved_key[0] != key:
        return "Incorrect key\n", 403
    c.execute(
        """
    DELETE FROM notes WHERE name=?
    """,
        (name,),
    )
    conn.commit()
    return 'Success! Note "{}" deleted\n'.format(name)


@app.route("/note/<name>")
def note(name):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT note FROM notes WHERE name=?", (name,))
    result = c.fetchone()
    note = result[0] if result else ""
    return render_template("render.html", name=name, note=note)


@app.route("/texdown/<name>")
@app.route("/texdown/note/<name>")
def texdown_note(name):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT note FROM notes WHERE name=?", (name,))
    result = c.fetchone()
    note = result[0] if result else ""
    return render_template("texdown.html", name=name, note=note)


@app.route("/code/<name>")
@app.route("/code/note/<name>")
def code_note(name):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT note FROM notes WHERE name=?", (name,))
    result = c.fetchone()
    note = result[0] if result else ""
    return render_template("code.html", name=name, note=note)


@app.route("/raw/<name>")
@app.route("/raw/note/<name>")
def raw_note(name):
    conn = get_db("notes")
    c = conn.cursor()
    c.execute("SELECT note FROM notes WHERE name=?", (name,))
    result = c.fetchone()
    note = result[0] if result else ""
    return note


app.run("0.0.0.0")
with app.app_context():
    db = get_db("notes")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (name text, note text, key text, author_ip text, date integer)
    """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS ips (ip text, count integer, date integer)
    """
    )
    db.commit()


@app.teardown_appcontext
def close_connection(exception):
    db_list = getattr(g, "_db_list", [])
    for db_name in db_list:
        db = get_db(db_name)
        db.close()
