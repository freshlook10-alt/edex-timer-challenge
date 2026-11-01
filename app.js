
/* EDEX TIMER CHALLENGE
   Third game, using the same Firebase project.
   Each game's records are kept separately.
*/

(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const adminPage = Boolean($("adminContent"));

  // SEPARATE FIREBASE COLLECTIONS FOR THIS GAME

  const liveRef =
    db.collection("timerGame").doc("live");

  const settingsRef =
    db.collection("timerSettings").doc("main");

  const statsRef =
    db.collection("timerStats").doc("total");

  const recordsRef =
    db.collection("timerHistory");

  const FieldValue = firebase.firestore.FieldValue;

  const baseLive = {
    stage: "idle",
    durationSec: 120,
    roundId: 0,
    startedAt: null,
    remainingSec: 120
  };

  const baseStats = {
    played: 0,
    wins: 0,
    losses: 0,
    chocolates: 0,
    stockTotal: null
  };

  let live = { ...baseLive };
  let settings = { durationSec: 120 };
  let stats = { ...baseStats };
  let records = [];

  let authorized = false;
  let busy = false;
  let privateUnsubs = [];

  const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, value));

  // FORMAT THE TIMER: 90 SECONDS = 01:30

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));

    const minutes =
      String(Math.floor(s / 60)).padStart(2, "0");

    const secs =
      String(s % 60).padStart(2, "0");

    return `${minutes}:${secs}`;
  }

  // ALLOW 01:30, 02:30, ETC.

  function parseDuration(value) {
    const str = String(value).trim();

    let seconds;

    if (/^\d{1,2}:\d{2}$/.test(str)) {
      const parts = str.split(":").map(Number);

      const minutes = parts[0];
      const secs = parts[1];

      if (secs >= 60) {
        throw Error("Seconds must be 00 to 59.");
      }

      seconds = minutes * 60 + secs;

    } else if (/^\d+(?:\.\d+)?$/.test(str)) {

      seconds = Math.round(Number(str) * 60);

    } else {

      throw Error(
        "Enter MM:SS, like 01:30 or 02:30."
      );
    }

    if (
      !Number.isSafeInteger(seconds) ||
      seconds < 15 ||
      seconds > 900
    ) {
      throw Error(
        "Choose a duration from 00:15 to 15:00."
      );
    }

    return seconds;
  }

  function effectiveDuration() {
    return Number(live.durationSec) > 0
      ? Number(live.durationSec)
      : 120;
  }

  function elapsedSec() {
    if (
      !live.startedAt ||
      typeof live.startedAt.toMillis !== "function"
    ) {
      return 0;
    }

    return Math.max(
      0,
      (Date.now() - live.startedAt.toMillis()) / 1000
    );
  }

  function remainingSec() {

    if (live.stage === "running") {
      return Math.max(
        0,
        effectiveDuration() - elapsedSec()
      );
    }

    if (live.stage === "idle") {
      return settings.durationSec || effectiveDuration();
    }

    return Number.isFinite(live.remainingSec)
      ? live.remainingSec
      : 0;
  }

  function visibleStage() {
    if (
      live.stage === "running" &&
      remainingSec() <= 0
    ) {
      return "expired";
    }

    return live.stage;
  }

  function showMessage(message, error = false) {
    if (!$("actionMessage")) return;

    $("actionMessage").textContent = message;

    $("actionMessage").classList.toggle(
      "error",
      error
    );
  }

  // RUN ORGANIZER ACTIONS SAFELY

  async function runAction(task, success) {
    if (!authorized || busy) return;

    busy = true;
    render();

    try {
      const result = await task();

      if (result !== false) {
        showMessage(
          success || "Saved and synchronized."
        );
      }

    } catch (error) {

      showMessage(
        error?.message || String(error),
        true
      );

    } finally {

      busy = false;
      render();
    }
  }

  // UPDATE LIVE TIMER AND BUTTONS

  function render() {
    const stage = visibleStage();

    const remaining = remainingSec();

    const duration = effectiveDuration();

    const time = formatTime(remaining);

    if ($("timeText")) {
      $("timeText").textContent = time;
    }

    if ($("adminTimer")) {
      $("adminTimer").textContent = time;
    }

    if ($("adminStage")) {
      $("adminStage").textContent =
        stage === "expired"
          ? "TIME IS UP"
          : stage.toUpperCase();
    }

    // TIMER RING ANIMATION

    if ($("progress")) {
      const circumference = 2 * Math.PI * 109;

      const fraction = clamp(
        remaining / duration,
        0,
        1
      );

      $("progress").style.strokeDasharray =
        String(circumference);

      $("progress").style.strokeDashoffset =
        String(circumference * (1 - fraction));
    }

    if ($("clock")) {
      $("clock").classList.toggle(
        "warning",
        stage === "running" && remaining <= 15
      );

      $("clock").classList.toggle(
        "expired",
        stage === "expired"
      );
    }

    const statuses = {
      idle: "STANDBY",
      running: "COUNTING DOWN",
      expired: "TIME IS UP",
      won: "CHALLENGE WON",
      failed: "CHALLENGE FAILED"
    };

    const messages = {
      idle: "WAITING FOR THE NEXT ROUND",
      running: "MAKE EVERY SECOND COUNT",
      expired: "TIME UP · RECORD FAILED",
      won: "WINNER · ONE CHOCOLATE RECORDED 🍫",
      failed: "ROUND ENDED · NO CHOCOLATE"
    };

    const subtitles = {
      idle: "Ready when you are.",
      running: "Your challenge is underway.",
      expired: "The countdown has ended.",
      won: "Congratulations! Challenge completed.",
      failed: "A fresh challenge is waiting."
    };

    if ($("timerStatus")) {
      $("timerStatus").textContent =
        statuses[stage] || "STANDBY";
    }

    if ($("challengeMessage")) {
      $("challengeMessage").textContent =
        messages[stage] || "";
    }

    if ($("subtitle")) {
      $("subtitle").textContent =
        subtitles[stage] || "";
    }

    if ($("roundLabel")) {
      $("roundLabel").textContent =
        `ROUND ${Number(live.roundId || 0)}`;
    }

    // ONLY THE ORGANIZER CAN CONTROL THE GAME

    if ($("operatorControls")) {
      $("operatorControls").hidden = !authorized;
    }

    if ($("access")) {
      $("access").hidden = authorized;
    }

    if ($("signedIn")) {
      $("signedIn").hidden = !authorized;
    }

    // BUTTON LOCKING PREVENTS DOUBLE RESULTS

    if ($("startBtn")) {
      $("startBtn").disabled =
        !authorized ||
        busy ||
        stage === "running" ||
        stage === "expired";
    }

    if ($("winBtn")) {
      $("winBtn").disabled =
        !authorized ||
        busy ||
        stage !== "running" ||
        remaining <= 0;
    }

    if ($("failBtn")) {
      $("failBtn").disabled =
        !authorized ||
        busy ||
        !["running", "expired"].includes(stage);
    }

    if ($("resetRoundBtn")) {
      $("resetRoundBtn").disabled =
        !authorized ||
        busy ||
        !["running", "expired"].includes(stage);
    }

    for (const id of [
      "saveDurationBtn",
      "stockBtn",
      "csvBtn",
      "resetHistoryBtn"
    ]) {
      if ($(id)) {
        $(id).disabled = !authorized || busy;
      }
    }
  }

  // UPDATE CHOCOLATE CALCULATOR

  function renderAdminStats() {
    if (!adminPage) return;

    for (const key of [
      "played",
      "wins",
      "losses",
      "chocolates"
    ]) {
      $(key).textContent =
        Number(stats[key] || 0).toLocaleString();
    }

    const tracked =
      Number.isSafeInteger(stats.stockTotal);

    $("stock").textContent = tracked
      ? stats.stockTotal.toLocaleString()
      : "—";

    $("remainingStock").textContent = tracked
      ? Math.max(
          0,
          stats.stockTotal -
          Number(stats.chocolates || 0)
        ).toLocaleString()
      : "—";

    // DISPLAY RESULT HISTORY

    const tbody = $("records");
    tbody.replaceChildren();

    if (!records.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 5;
      cell.textContent =
        "No completed rounds recorded yet.";

      row.append(cell);
      tbody.append(row);
    }

    for (const record of records) {
      const row = document.createElement("tr");

      const values = [
        record.at?.toDate?.().toLocaleString()
          || "Pending",

        `#${record.roundId || "—"}`,

        record.outcome === "won"
          ? "WON"
          : "FAILED",

        String(record.chocolate || 0),

        formatTime(record.elapsedSec || 0)
      ];

      values.forEach((value, index) => {
        const cell = document.createElement("td");

        cell.textContent = value;

        if (index === 2) {
          cell.className =
            record.outcome === "won"
              ? "win"
              : "fail";
        }

        row.append(cell);
      });

      tbody.append(row);
    }
  }

  // START A NEW TIMER ROUND

  async function startTimer() {
    await db.runTransaction(async transaction => {

      const [liveSnapshot, settingSnapshot] =
        await Promise.all([
          transaction.get(liveRef),
          transaction.get(settingsRef)
        ]);

      const previous = {
        ...baseLive,
        ...(liveSnapshot.data() || {})
      };

      if (previous.stage === "running") {
        throw Error(
          "Finish or reset the active round first."
        );
      }

      const seconds = Number(
        settingSnapshot.data()?.durationSec || 120
      );

      if (
        !Number.isSafeInteger(seconds) ||
        seconds < 15 ||
        seconds > 900
      ) {
        throw Error("Set a valid timer first.");
      }

      transaction.set(
        liveRef,
        {
          stage: "running",
          roundId: Number(previous.roundId || 0) + 1,
          durationSec: seconds,
          remainingSec: seconds,
          startedAt: FieldValue.serverTimestamp(),
          finishedAt: null
        },
        { merge: true }
      );

    });
  }

  // WON OR FAILED: STORE THE RESULT ONCE

  async function finishRound(won) {
    const newRecord = recordsRef.doc();

    await db.runTransaction(async transaction => {

      const [liveSnapshot, statsSnapshot] =
        await Promise.all([
          transaction.get(liveRef),
          transaction.get(statsRef)
        ]);

      const current = liveSnapshot.data();

      if (
        !current ||
        current.stage !== "running" ||
        !current.startedAt?.toMillis
      ) {
        throw Error(
          "No active round. Start the timer first."
        );
      }

      const elapsed = Math.max(
        0,
        (
          Date.now() -
          current.startedAt.toMillis()
        ) / 1000
      );

      // NO WIN AFTER TIME IS UP

      if (
        won &&
        elapsed >= Number(current.durationSec)
      ) {
        throw Error(
          "Time is up. Select FAILED instead."
        );
      }

      const currentStats = {
        ...baseStats,
        ...(statsSnapshot.data() || {})
      };

      // CHECK CHOCOLATE INVENTORY

      if (
        won &&
        Number.isSafeInteger(currentStats.stockTotal) &&
        Number(currentStats.chocolates || 0) >=
          currentStats.stockTotal
      ) {
        throw Error(
          "Chocolate stock is empty. Update your stock in Admin first."
        );
      }

      const spent = Math.min(
        Number(current.durationSec),
        Math.floor(elapsed)
      );

      const remaining = Math.max(
        0,
        Number(current.durationSec) - elapsed
      );

      // ADD NEW ROUND TO HISTORY

      transaction.set(newRecord, {
        roundId: current.roundId,
        outcome: won ? "won" : "failed",
        chocolate: won ? 1 : 0,
        durationSec: current.durationSec,
        elapsedSec: spent,
        at: FieldValue.serverTimestamp()
      });

      // UPDATE ADMIN COUNTERS

      transaction.set(
        statsRef,
        {
          played: FieldValue.increment(1),
          wins: FieldValue.increment(won ? 1 : 0),
          losses: FieldValue.increment(won ? 0 : 1),
          chocolates: FieldValue.increment(won ? 1 : 0)
        },
        { merge: true }
      );

      // STOP THE CURRENT TIMER

      transaction.update(liveRef, {
        stage: won ? "won" : "failed",
        remainingSec: remaining,
        finishedAt: FieldValue.serverTimestamp()
      });

    });
  }

  // RESET CURRENT ATTEMPT WITHOUT A RESULT

  async function resetRound() {

    if (
      !window.confirm(
        "Reset this timer? No Won/Failed or chocolate will be recorded."
      )
    ) {
      return false;
    }

    await db.runTransaction(async transaction => {

      const snapshot =
        await transaction.get(liveRef);

      const current =
        snapshot.data() || baseLive;

      if (current.stage !== "running") {
        throw Error(
          "There is no running round to reset."
        );
      }

      transaction.set(
        liveRef,
        {
          stage: "idle",
          startedAt: null,
          remainingSec:
            Number(current.durationSec || 120)
        },
        { merge: true }
      );

    });
  }

  // SAVE TIMER DURATION

  async function saveDuration() {
    const seconds =
      parseDuration($("durationInput").value);

    await settingsRef.set(
      { durationSec: seconds },
      { merge: true }
    );

    $("durationInput").value =
      formatTime(seconds);
  }

  // SAVE CHOCOLATE STOCK

  async function saveStock() {
    const raw = $("stockInput").value.trim();
    const count = Number(raw);

    if (
      raw === "" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      throw Error(
        "Enter a whole number of chocolates."
      );
    }

    await db.runTransaction(async transaction => {

      const snapshot =
        await transaction.get(statsRef);

      const given =
        Number(snapshot.data()?.chocolates || 0);

      if (count < given) {
        throw Error(
          `Stock cannot be less than ${given} already distributed chocolates.`
        );
      }

      transaction.set(
        statsRef,
        { stockTotal: count },
        { merge: true }
      );

    });
  }

  // EXPORT COMPLETE RESULT HISTORY AS CSV

  async function exportCSV() {
    const snapshot = await recordsRef
      .orderBy("at", "desc")
      .get();

    const rows = [[
      "Date",
      "Round",
      "Result",
      "Chocolates",
      "Time Used (sec)",
      "Timer Duration (sec)"
    ]];

    snapshot.docs.forEach(doc => {
      const record = doc.data();

      rows.push([
        record.at?.toDate?.().toISOString() || "",
        record.roundId || "",
        record.outcome || "",
        record.chocolate || 0,
        record.elapsedSec || 0,
        record.durationSec || ""
      ]);
    });

    const csv = "\ufeff" +
      rows.map(row =>
        row.map(value =>
          '"' +
          String(value ?? "").replace(/"/g, '""') +
          '"'
        ).join(",")
      ).join("\r\n");

    const url = URL.createObjectURL(
      new Blob([csv], {
        type: "text/csv;charset=utf-8"
      })
    );

    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download =
      "edex-timer-challenge-records.csv";

    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );
  }

  // RESET ONLY THIS GAME'S PLAYED RECORDS

  async function resetAllPlayedRecords() {

    const confirmed = window.confirm(
      "Clear ONLY Timer Challenge played rounds, wins, losses and chocolates? The Ball Game and Quiz will NOT be touched."
    );

    if (!confirmed) return false;

    const password = window.prompt(
      "Enter your organizer password to confirm:"
    );

    if (password === null) return false;

    const user = auth.currentUser;

    if (!user?.email) {
      throw Error("Please sign in again.");
    }

    // REQUIRE ORGANIZER PASSWORD AGAIN

    const credential =
      firebase.auth.EmailAuthProvider.credential(
        user.email,
        password
      );

    await user.reauthenticateWithCredential(
      credential
    );

    const current = await liveRef.get();

    if (current.data()?.stage === "running") {
      throw Error(
        "Finish or reset the current round first."
      );
    }

    // DELETE TIMER HISTORY IN BATCHES

    while (true) {

      const snapshot =
        await recordsRef.limit(350).get();

      if (snapshot.empty) break;

      const batch = db.batch();

      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
    }

    // PRESERVE ACTUAL REMAINING CHOCOLATES

    const oldStats =
      (await statsRef.get()).data() || {};

    const stockStillAvailable =
      Number.isSafeInteger(oldStats.stockTotal)
        ? Math.max(
            0,
            oldStats.stockTotal -
            Number(oldStats.chocolates || 0)
          )
        : null;

    // RESET COUNTERS TO ZERO

    await statsRef.set(
      {
        played: 0,
        wins: 0,
        losses: 0,
        chocolates: 0,
        stockTotal: stockStillAvailable
      },
      { merge: true }
    );

    // RESET THE VISITOR TIMER

    await liveRef.set(
      {
        stage: "idle",
        startedAt: null,
        remainingSec:
          Number(settings.durationSec || 120)
      },
      { merge: true }
    );

    $("stockInput").value = "";
  }

  // REAL-TIME FIREBASE CONNECTION

  function addListeners() {

    // VISITORS CAN WATCH TIMER WITHOUT LOGIN

    liveRef.onSnapshot(
      snapshot => {

        live = snapshot.exists
          ? {
              ...baseLive,
              ...snapshot.data({
                serverTimestamps: "estimate"
              })
            }
          : { ...baseLive };

        if ($("connection")) {
          $("connection").textContent = "LIVE";
        }

        render();
      },
      error => {

        if ($("connection")) {
          $("connection").textContent = "OFFLINE";
        }

        showMessage(
          "Firebase connection: " +
          (error?.message || error),
          true
        );
      }
    );

    // UPDATE THE CLOCK REGULARLY

    window.setInterval(render, 180);
  }

  function stopPrivateListeners() {
    privateUnsubs.forEach(unsubscribe => {
      unsubscribe();
    });

    privateUnsubs = [];
  }

  function beginPrivateListeners() {

    privateUnsubs.push(
      settingsRef.onSnapshot(
        snapshot => {

          settings = {
            durationSec: 120,
            ...(snapshot.data() || {})
          };

          if ($("durationInput")) {
            $("durationInput").value =
              formatTime(settings.durationSec);
          }

          render();
        },
        error => showMessage(
          error.message,
          true
        )
      )
    );

    if (adminPage) {

      // LIVE ADMIN STATISTICS

      privateUnsubs.push(
        statsRef.onSnapshot(
          snapshot => {

            stats = {
              ...baseStats,
              ...(snapshot.data() || {})
            };

            renderAdminStats();
            render();
          },
          error => showMessage(
            error.message,
            true
          )
        )
      );

      // LIVE HISTORY TABLE

      privateUnsubs.push(
        recordsRef
          .orderBy("at", "desc")
          .limit(200)
          .onSnapshot(
            snapshot => {

              records = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
              }));

              renderAdminStats();
              render();
            },
            error => showMessage(
              error.message,
              true
            )
          )
      );
    }
  }

  // CONNECT HTML BUTTONS TO FUNCTIONS

  function bindButtons() {

    $("loginForm").addEventListener(
      "submit",
      async event => {

        event.preventDefault();

        $("loginError").textContent = "";

        try {

          const result =
            await auth.signInWithEmailAndPassword(
              $("email").value,
              $("password").value
            );

          if (result.user.uid !== ADMIN_UID) {
            await auth.signOut();

            throw Error(
              "This account is not the authorized EDEX organizer."
            );
          }

          $("password").value = "";

        } catch (error) {

          $("loginError").textContent =
            error?.message || String(error);
        }
      }
    );

    $("signOutBtn").addEventListener(
      "click",
      () => auth.signOut()
    );

    $("startBtn").onclick = () =>
      runAction(
        startTimer,
        "Timer started! Visitor display synchronized."
      );

    $("winBtn").onclick = () =>
      runAction(
        () => finishRound(true),
        "🍫 WON! One chocolate recorded."
      );

    $("failBtn").onclick = () =>
      runAction(
        () => finishRound(false),
        "FAILED. No chocolate recorded."
      );

    $("resetRoundBtn").onclick = () =>
      runAction(
        resetRound,
        "Timer reset without recording."
      );

    // ADMIN PAGE BUTTONS

    if (adminPage) {

      $("saveDurationBtn").onclick = () =>
        runAction(
          saveDuration,
          "Timer duration saved."
        );

      $("stockBtn").onclick = () =>
        runAction(
          saveStock,
          "Chocolate stock saved."
        );

      $("csvBtn").onclick = () =>
        runAction(
          exportCSV,
          "CSV exported."
        );

      $("resetHistoryBtn").onclick = () =>
        runAction(
          resetAllPlayedRecords,
          "Timer records reset. Remaining stock preserved."
        );

      // LINKS TO EXISTING TWO ADMIN PANELS

      if (
        typeof QUIZ_ADMIN_URL === "string" &&
        /^https:\/\//.test(QUIZ_ADMIN_URL)
      ) {
        $("quizAdminLink").href = QUIZ_ADMIN_URL;
        $("quizAdminLink").hidden = false;
      }

      if (
        typeof BALL_ADMIN_URL === "string" &&
        /^https:\/\//.test(BALL_ADMIN_URL)
      ) {
        $("ballAdminLink").href = BALL_ADMIN_URL;
        $("ballAdminLink").hidden = false;
      }
    }

    // SAME FIREBASE ORGANIZER LOGIN

    auth.onAuthStateChanged(user => {

      authorized = Boolean(
        user &&
        user.uid === ADMIN_UID
      );

      stopPrivateListeners();

      if (user && !authorized) {
        auth.signOut();

        showMessage(
          "Organizer access denied.",
          true
        );

        return;
      }

      if (authorized) {
        beginPrivateListeners();
      }

      if (adminPage) {

        $("adminLogin").hidden = authorized;

        $("adminContent").hidden = !authorized;

        if (authorized) {
          renderAdminStats();
        }
      }

      render();
    });
  }

  // START THE WEBSITE

  addListeners();
  bindButtons();
  render();

})();
