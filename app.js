import { nanoid } from 'https://cdn.jsdelivr.net/npm/nanoid/nanoid.js';

console.log("app.js loaded - supabase manager");

const supabaseUrl = "https://rleuqloizbckhiaczjeq.supabase.co";
const supabaseKey = "sb_publishable_Wf5G3ksZos56d_MCoelAKA_dHH_AThD";

const supabaseClient = window.supabase.createClient(
  supabaseUrl,
  supabaseKey, 
  {
    realtime: {
        params: {
            events_per_second: 10,
        },
        // 재연결 시도 간격 및 타임아웃 설정 (라이브러리 버전에 따라 다를 수 있음)
        timeout: 20000, 
    }
  }
);

document.addEventListener("DOMContentLoaded", async () => {

  const path = window.location.pathname;
  const { data: { session } } = await supabaseClient.auth.getSession();

  console.log("app.js DOMContentLoaded loaded", path)

  // =========================
  // 📌 login.html (로그인 페이지)
  // =========================
  if (path.includes("login.html") || path === "/") {

    if (session) {
      window.location.replace("main.html");
      return;
    }

    const loginBtn = document.getElementById("loginBtn");

    if (loginBtn) {
      loginBtn.addEventListener("click", async () => {
        const email = document.getElementById("email").value;
        const password = document.getElementById("password").value;

        console.info("login:", email, password);

        const { error } = await supabaseClient.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          document.getElementById("error").innerText = error.message;
          return;
        }

        window.location.replace("main.html");
      });
    } else { console.error("!!!! login button !!!!"); }
  }

  // =========================
  // 📌 main.html
  // =========================
  if (path.includes("main.html")) {

    if (!session) {
      window.location.replace("login.html");
      return;
    }

    if(!window.comp_id) await getCompanyId();
    console.log("company_id = ", window.comp_id)
    if(!window.robots) await getRobots();
    console.log("robots = ", window.robots)
    if(!window.session_id) window.session_id = await getSessionId();
    console.log("session_id = ", window.session_id);

    const robotListElement = document.getElementById("robotList");
    if(robotListElement) {
      renderRobots(window.robots, robotListElement);
    }

    // 🔹 Realtime 채널 연결
    const channel = supabaseClient.channel(window.comp_id);
    const handleReceivedMessage = (payload) => {
      // console.log("received = ", payload);
      const message = payload.payload;
      if(message.type === "pong") {
        // const robotId = payload.from;
        setOnlineRobot(message.from);
      } else if(message.type === "response") {
        // 외부 함수
        if(typeof onReceivedResponse === "function") {
          onReceivedResponse(message.from, message.command, message)
        } else { console.error("need to defien function onReceivedResponse") }
      } else if(message.type === "command") {
        if(message.command_name === "webrtc_signal") {
          console.info("received webrtc_signal", message.from, message);
          // const event = new CustomEvent('webrtc-signal', { 
          //     detail: { sender: message.from, message: message } 
          // });
          // window.dispatchEvent(event);
          if(typeof onReceivedWebRtcSignal === "function") {
            onReceivedWebRtcSignal(message.from, message);
          } else { console.error("need to define function onReceivedWebRtcSignal")}
        } else if(message.command_name === "request_call_ready") {
          const msg_type = message.message_type
          if(msg_type === "new") {
            const isAccepted = confirm("call request recevied");
            let ack = "ack";

            if (isAccepted) {
                console.log("수락됨: WebRTC 시그널링 시작");
                ack = "ack";
            } else {
              ack = "nack";
                console.log("거절됨");
            }

            sendMessage(
              message.from, {
                "type" : "command",
                "command_name" : "request_call_ready",
                "message_type" : ack,
                "message" : "callable????",
                "from" : window.session_id
              }
            );

          }
          else if(msg_type === "ack") {
            createOfferAndSendMessage(message.from);
          } else { //if(ack === "nack") {
            alert("rejected= ", message.message);
          }
        } else {
          console.error("unknown command", message);
        }
      } else {
        console.error("unknown", message);
      }
    };

    channel.on("broadcast", { event: window.comp_id }, handleReceivedMessage);
    channel.on("broadcast", { event: window.session_id }, handleReceivedMessage);
    channel.on("broadcast", { event: "robot_connected" }, (payload) => {
      console.log("received = ", payload);
      const message = payload.payload;
      setOnlineRobot(message.robot_id);
    });

    channel.subscribe((status) => {
      console.log("Supabase Realtime 상태:", status);
    });

    const checkRobotStatusBtn = document.getElementById("checkedOnline");
    if(checkRobotStatusBtn) {
      checkRobotStatusBtn.addEventListener("click", async () => {
        console.info("=== checkedOnline ===")
        await broadcastPing(channel);
      });
    }
    
    // // 🔹 전송 버튼
    // const sendBtn = document.getElementById("sendBtn");
    // if (sendBtn) {
    //   sendBtn.addEventListener("click", async () => {
    //     await channel.send({
    //       type: "broadcast",
    //       event: "move",
    //       payload: { direction: "forward" }
    //     });

    //     console.log("전송 완료");
    //   });
    // }

    // 🔹 로그아웃 버튼
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await supabaseClient.auth.signOut();
        window.location.replace("login.html");
      });
    }

    ////////////////////////////////////////////////////////////////////////////////
    // functions
    async function sendMessage(event, payload) {
      channel.send({
        type: "broadcast",
        event: event,
        payload: payload,
        is_private: true   // 인증된 유저만 수신
      })
    }

    async function getCompanyId() {
    if(session) {
      const user = session.user;
      const { data, error } = await supabaseClient
        .from("companies")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      console.log("get company id: ", data, error)
      if(error) {
        console.error(error);
      } else window.comp_id = data?.id;
    }
  }

  async function getRobots() {
    if(session && window.comp_id) {
      const { data, error } = await supabaseClient
        .from("robots")
        .select("id, nickname, serial_number")
        .eq("company_id", window.comp_id)

      console.log("get robots: ", data, error)
      if(error) {
        console.error(error)
      } else window.robots = data
    }
  }

  async function getSessionId() {
    let sid = sessionStorage.getItem('browser_session_id');
    if(!sid) {
      console.log("create sesssion id");
      sid = `admin:sess_${nanoid(12)}`;
      sessionStorage.setItem('browser_session_id', sid);
    }
    return sid;
  }

  async function broadcastPing() {
    window.robots.forEach(robot => {
      sendMessage(
        robot.id, {
          "type": "ping",
          "from" : window.session_id
        }
      );
      // channel.send({
      //   type: "broadcast",
      //   event: robot.id,
      //   payload: {
      //     "type": "ping",
      //     "from" : window.comp_id
      //   }
      // })
    });
   }

    // 외부에서 사용 가능한 함수 설정하기
    window.getSelectedRobotId = function getSelectedRobotId() {
      const selected = document.querySelector(
        '#robotList input[name="robot"]:checked'
      )
      return selected?.value
    }
    window.sendRequestMessage = function sendRequestMessage(target) {
      sendMessage(
        target, {
          "type" : "command",
          "command_name" : "request_call_ready",
          "message_type" : "new",
          "message" : "callable????",
          "from" : window.session_id
        }
      )
    }
    window.sendOfferMessage = function sendOfferMessage(target, jsonstring) {
      sendMessage(
        target, {
          "type" : "command",
          "command_name" : "webrtc_signal",
          "signal_type" : "offer",
          "sdp" : jsonstring,
          "from" : window.session_id
        }
      );
    }
    window.sendAnswerMessage = function sendAnswerMessage(target, jsonstring) {
      sendMessage(
        target, {
          "type" : "command",
          "command_name" : "webrtc_signal",
          "signal_type" : "answer",
          "sdp" : jsonstring,
          "from" : window.session_id
        }
      );
    }
    window.sendCandidateMessage = function sendCandidateMessage(target, jsonstring) {
      sendMessage(
        target, {
          "type" : "command",
          "command_name" : "webrtc_signal",
          "signal_type" : "candidate",
          "candidate" : jsonstring,
          "from" : window.session_id
        }
      );
    }
  }

  // async function sendMessage(channel, event, payload) {
  //   if (channel.status === 'CONNECTED') {
  //     channel.send({ type: 'broadcast', event: event, payload });
  //   } else {
  //     await channel.httpSend({ type: 'broadcast', event: event, payload });
  //   }
  // }


  

  



});



function setOnlineRobot(robotId) {
  const input = document.querySelector(
    `input[data-robot-id="${robotId}"]`
  );
  console.log("input = ", input);
  if(input) {
    input.disabled = false;
  }
}


// ui
function renderRobots(robots, robotListElement) {
  if(!robots || robots.length == 0) {
    robotListElement.innerHTML = "none";
  } else {
    robotListElement.innerHTML = robots
      .map(robot => `
        <label style="display:block; margin:5px 0;">
          <input type="radio" name="robot" value="${robot.id}" disabled data-robot-id="${robot.id}"/>
          <span>${robot.nickname}: ${robot.serial_number}</span>
        </label>
      `)
      .join("");
  }
}