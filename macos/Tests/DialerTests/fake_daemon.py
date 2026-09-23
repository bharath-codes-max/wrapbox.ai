import socket, threading, time, sys
def serve(port, behaviour):
    s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("127.0.0.1",port)); s.listen(16)
    while True:
        c,_=s.accept()
        def h(c=c):
            req=b""
            try:
                c.settimeout(3)
                while b"\r\n\r\n" not in req:
                    d=c.recv(4096)
                    if not d: break
                    req+=d
                if port==47704: open(sys.argv[1]+"/seen.txt","wb").write(req)
                behaviour(c)
            except Exception: pass
        threading.Thread(target=h,daemon=True).start()
def silent(c): time.sleep(10)
def r403(c): c.sendall(b"HTTP/1.1 403 Forbidden\r\nX-Wrapbox-Reason: blocked by policy\r\n\r\n"); time.sleep(1)
def r200(c): c.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\nLEFTOVER"); time.sleep(3)
def huge(c): c.sendall(b"X"*20000); time.sleep(2)
def garbage(c): c.sendall(b"not http at all\r\n\r\n"); time.sleep(1)
def hangup(c): c.close()
for p,b in [(47702,silent),(47703,r403),(47704,r200),(47705,huge),(47706,garbage),(47707,hangup)]:
    threading.Thread(target=serve,args=(p,b),daemon=True).start()
time.sleep(40)
