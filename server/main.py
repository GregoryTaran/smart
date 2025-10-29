from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uuid
app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello from FastAPI on Render!"}

@app.get("/health")
async def health():
    return {"status": "ok"}

# Simple echo WebSocket example (client can connect to wss://your-service.onrender.com/ws)
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    client_id = str(uuid.uuid4())
    try:
        while True:
            data = await ws.receive_text()
            await ws.send_text(f"echo ({client_id}): " + data)
    except WebSocketDisconnect:
        print("WebSocket disconnected:", client_id)
