# jott
A minimal tool for writing quick notes.  Check out https://jott.live for a demo.

### Website

Navigate to the site and set a title in the 'name' field.  To set a key for editing the note, use
'name#key' in that field.

- `/note/<note-name>` will return the default HTML rendering of the note.
- `/texdown/note/<note-name>` will return a minimal [TeXDown](https://github.com/tex-ninja/texdown#texdown) rendering of the note.
- `/raw/note/<note-name>` will return the raw note. (Useful for the command line.)
- `/edit/note/<note-name>` will open a basic editor for the note.


### Command line

The `note` script in `jott/scripts` makes it easy to upload and read notes from the command line.

```
$ echo "this is a test" | note my_test_note secret_password
Success! Note "my_test_note" saved
$ note my_test_note
this is a test
$ echo "updating without the key" | note my_test_note
Note already saved with different key
$ note my_test_note
this is a test
$ note -d my_test_note secret_password
Success! Note "my_test_note" deleted
```

## Installation
Although you can use https://jott.live to test out this project, do not rely on it for anything important.

If you find this useful, I'd recommend hosting your own instance.  It is quite lightweight.

Requirements:
- flask (`pip install flask`)

Run the server with
```
FLASK_ENV=prod python3 main.py
```

