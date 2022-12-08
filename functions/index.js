const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert('./interface-project-1-068235219f2c.json'),
});
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

exports.addMessage = functions.https.onRequest(async (req, res) => {
  // Grab the text parameter.
  const original = req.query.text;
  // Push the new message into Firestore using the Firebase Admin SDK.
  const writeResult = await admin
    .firestore()
    .collection('messages')
    .add({ original: original });
  // Send back a message that we've successfully written the message
  res.json({ result: `Message with ID: ${writeResult.id} added.` });
});

// 새로운 기기가 그룹에 들어온 경우
exports.boradcastWelcomeFSMToGroup = functions.firestore
  .document('/deviceInfo/{deviceID}')
  .onWrite(async (change, context) => {
    const beforeGroupIDs = change?.before?.data()?.groupIDs || [];
    const afterGroupIDs = change?.after?.data()?.groupIDs || [];

    const enteredGroupID = afterGroupIDs.filter(
      (id) => !beforeGroupIDs.includes(id)
    );
    console.log(enteredGroupID + ' 에 새로운 기기가 참여하였습니다');

    // 새로운 그룹에 들어간 경우에만
    if (enteredGroupID.length === 0) return;

    // groupID 에 속한 기기 찾기
    const deviceRef = admin.firestore().collection(`deviceInfo`);
    const deviceIDInTargetGroups = await deviceRef
      .where('groupIDs', 'array-contains-any', enteredGroupID)
      .get();

    const targetFCMTokens = [];
    deviceIDInTargetGroups.docs.forEach((doc) => {
      if (doc.id === context.params.deviceID) return;
      const { FCMToken } = doc.data();
      targetFCMTokens.push(FCMToken);
    });

    console.log(targetFCMTokens + '의 토큰을 가진 기기들에게 FCM을 발송합니다');

    broadcastFCMToSIds(targetFCMTokens, {
      title: '새로운 기기 입장',
      text: `새로운 기기가 그룹에 입장하였습니다`,
    });
  });

// 알림이 새롭게 추가되면.
exports.boradcastNotiFSMToGroup = functions.firestore
  .document('/notis/{notiID}')
  .onCreate(async (change, context) => {
    // 알림이 추가되면,
    // 알림에 속한 groupInfo 중 groupID를 가져와서,
    const {
      appName,
      deviceID,
      deviceNickname,
      groupID,
      packageName,
      postTime,
      subText,
      text,
      title,
    } = change.data();

    if (!groupID) return console.log('groupID가 없습니다.');
    if (!deviceID) return console.log('deviceID 없습니다.');

    console.log(
      `${deviceNickname}이 ${title || text || subText} 알람을 발송하였습니다`
    );

    const deviceRef = db.collection(`deviceInfo`);
    const deviceIDInTargetGroups = await deviceRef
      .where('groupIDs', 'array-contains', groupID)
      .get();

    // 알람을 발송한 기기 제외 후 FCM 토큰 저장
    const notiProviderDeviceFCMRef = await deviceRef?.doc(deviceID).get();
    const notiProviderDeviceFCM = notiProviderDeviceFCMRef.get('FCMToken');

    const targetFCMTokens = [];
    deviceIDInTargetGroups.docs.forEach((doc) => {
      const { FCMToken } = doc.data();
      if (!FCMToken) return;
      targetFCMTokens.push(FCMToken);
    });

    const filteredTargetFCMTokens = targetFCMTokens.filter(
      (token) => token !== notiProviderDeviceFCM
    );

    // const filteredTargetFCMTokens = targetFCMTokens;

    // FCMBody의 text 생성하는 부분
    const FCMTitle = `${deviceNickname || '노티디마쉐어'}의 ${
      appName || '알람'
    }`;
    const isTextNull = !text && !subText;
    const FCMText = `[${title || '알람'}] ${text || ''} ${subText || ''} ${
      isTextNull ? '새로운 알람이 도착했습니다' : ''
    }`;

    const FCMBody = {
      title: FCMTitle,
      text: FCMText,
    };

    broadcastFCMToSIds(filteredTargetFCMTokens, FCMBody);

    try {
      // groupID 정보 업데이트하기
      const groupDocRef = db.collection('groupID').doc(groupID);
      const groupSnap = await groupDocRef.get();
      return groupDocRef.update({
        lastMessage: text || subText || '새로운 알람이 도착했어요',
        lastTime: postTime || '00',
      });
    } catch (e) {
      console.error(e);
    }
  });

const broadcastFCMToSIds = (tokens, notiInfo) => {
  const payload = {
    notification: {
      title: notiInfo.title || 'notiShare',
      body: notiInfo.text,
    },
  };

  try {
    tokens.forEach((token) => {
      admin.messaging().sendToDevice(token, payload);
      console.log(token.slice(0, 5), 'FCM Send Comleted');
    });
  } catch (e) {
    console.log(e);
  }
};
