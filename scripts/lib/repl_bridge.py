# Persistent Python interpreter for the python_repl MCP tool (absorbs OMC's gyoshu bridge, much smaller).
# Requests arrive as JSON lines on stdin; replies go to fd 3, so user code writing to fd 1 cannot corrupt the protocol.
# Runs on Python 3.8+ (no match statements, no X | Y hints).
import contextlib
import io
import json
import os
import signal
import sys
import traceback

proto = os.fdopen(3, "w")
os.dup2(2, 1)  # raw writes to fd 1 (os.write, subprocesses) land on stderr, which the host drains
ns = {"__name__": "__main__"}
signal.signal(signal.SIGINT, signal.default_int_handler)  # even if the parent ignored SIGINT


class Capped(io.StringIO):
    """Keeps the first 1M characters (OMC's cap) so one print loop cannot flood the MCP reply."""
    LIMIT = 1048576

    def write(self, s):
        room = self.LIMIT - self.tell()
        if room > 0:
            super().write(s[:room])
        return len(s)

    def getvalue(self):
        v = super().getvalue()
        return v + "\n[OUTPUT TRUNCATED - exceeded 1MB limit]" if len(v) >= self.LIMIT else v


def reply(**msg):
    proto.write(json.dumps(msg) + "\n")
    proto.flush()


def execute(code):
    out, err, error = Capped(), Capped(), None
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            exec(compile(code, "<repl>", "exec"), ns)
    except BaseException as e:  # KeyboardInterrupt (timeout/interrupt) and SystemExit must not end the session
        tb = e.__traceback__.tb_next if e.__traceback__ else None  # drop this bridge's frame
        error = "".join(traceback.format_exception(type(e), e, tb)).rstrip()
    reply(stdout=out.getvalue(), stderr=err.getvalue(), error=error)


while True:
    try:
        line = sys.stdin.readline()
        if not line:
            break
        req = json.loads(line)
        proto.write(json.dumps({"ack": True}) + "\n")  # received: from here on the code may run
        proto.flush()
        action = req.get("action")
        if action == "execute":
            execute(req.get("code", ""))
        elif action == "reset":
            ns.clear()
            ns["__name__"] = "__main__"
            reply(status="namespace cleared")
        elif action == "get_state":
            reply(variables=sorted(k for k in ns if not k.startswith("_")))
        else:
            reply(error="unknown action: %s" % action)
    except KeyboardInterrupt:
        continue  # an interrupt that arrived between requests
