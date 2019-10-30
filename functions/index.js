const functions = require('firebase-functions');
const admin = require('firebase-admin');
const cors = require('cors')({origin: true});

admin.initializeApp();

const FieldValue = admin.firestore.FieldValue;

const usersRef = admin.firestore().collection('users');
const couplesRef = admin.firestore().collection('couples');

//errors
const ERROR_INTERNAL = 'ERROR_INTERNAL';
const ERROR_NOT_AUTHENTICATED = 'ERROR_NOT_AUTHENTICATED';
const ERROR_USER_NOT_FOUND = 'ERROR_USER_NOT_FOUND';
const ERROR_RECEIVER_ALREADY_HAS_PARTNER = 'ERROR_RECEIVER_ALREADY_HAS_PARTNER';
const ERROR_RECEIVER_HAS_PENDING_REQUEST = 'ERROR_RECEIVER_HAS_PENDING_REQUEST';
const ERROR_RECEIVER_EMAIL_REQUIRED = 'ERROR_RECEIVER_EMAIL_REQUIRED';
const ERROR_RECEIVER_EMAIL_IS_SENDERS = 'ERROR_RECEIVER_EMAIL_IS_SENDERS';

// TODO: when deleting user doc make sure to delete any active partner requests first

exports.sendPartnerRequest = functions.region('europe-west1').https.onCall(async (data, context) => {

    if (context.auth === null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }

    if (data === null || data.email === null) {
        throw new functions.https.HttpsError('invalid-argument', ERROR_RECEIVER_EMAIL_REQUIRED);
    }

    if (data.email === context.auth.token.email) {
        throw new functions.https.HttpsError('invalid-argument', ERROR_RECEIVER_EMAIL_IS_SENDERS);
    }

    const senderUid = context.auth.uid;
    const senderRef = usersRef.doc(senderUid);
    const senderDoc = await senderRef.get();
    // todo: get name and email from auth instead of db
    //const senderName = context.auth.token.name || '';
    //const senderEmail = context.auth.token.email || '';
    const senderEmail = senderDoc.data().email !== null ? senderDoc.data().email : '';
    const senderName = senderDoc.data().name !== null ? senderDoc.data().name : '';

    const receiverEmail = data.email;

    try {
        let snapshots = await usersRef.where('email', '==', receiverEmail).get();
        if (snapshots.empty) {
            // no matching documents
            throw new Error(ERROR_USER_NOT_FOUND);
        }

        const receiverRef = snapshots.docs[0].ref;

        await admin.firestore().runTransaction(async t => {
            const doc = await t.get(receiverRef);
            const uid = doc.id;
            const email = doc.data().email !== null ? doc.data().email : '';
            const name = doc.data().name !== null ? doc.data().name : '';
            const partner = doc.data().partner;
            const partnerRequestFrom = doc.data().partnerRequestFrom;
            const partnerRequestTo = doc.data().partnerRequestTo;

            if (partner != null) {
                throw new Error(ERROR_RECEIVER_ALREADY_HAS_PARTNER);
            } else if (partnerRequestFrom !== null || partnerRequestTo !== null) {
                throw new Error(ERROR_RECEIVER_HAS_PENDING_REQUEST);
            }

            t.update(receiverRef, { partnerRequestFrom: { uid: senderUid, email: senderEmail, name: senderName } });
            t.update(senderRef, { partnerRequestTo: { uid: uid, email: email, name: name } })
        });
    } catch (e) {
        console.log(e);
        if (e instanceof Error) {
            if (e.message === ERROR_USER_NOT_FOUND) {
                throw new functions.https.HttpsError('not-found', ERROR_USER_NOT_FOUND);
            } else if (e.message === ERROR_RECEIVER_ALREADY_HAS_PARTNER) {
                throw new functions.https.HttpsError('already-exists', ERROR_RECEIVER_ALREADY_HAS_PARTNER);
            } else if (e.message === ERROR_RECEIVER_HAS_PENDING_REQUEST) {
                throw new functions.https.HttpsError('already-exists', ERROR_RECEIVER_HAS_PENDING_REQUEST);
            }
        }
        throw new functions.https.HttpsError('internal', ERROR_INTERNAL);
    }
});

exports.cancelPartnerRequest = functions.region('europe-west1').https.onCall(async (data, context) => {

    if (context.auth === null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }

    const senderUid = context.auth.uid;
    const senderRef = usersRef.doc(senderUid);

    try {
        await admin.firestore().runTransaction(async t => {
            const doc = await t.get(senderRef);
            const receiver = doc.data().partnerRequestTo;
            const receiverRef = usersRef.doc(receiver.uid);

            t.update(receiverRef, { partnerRequestFrom: FieldValue.delete() });
            t.update(senderRef, { partnerRequestTo: FieldValue.delete() });
        });
    } catch (e) {
        throw new functions.https.HttpsError('internal', ERROR_INTERNAL);
    }
});

exports.acceptPartnerRequest = functions.region('europe-west1').https.onCall(async (data, context) => {

    if (context.auth === null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }

    const receiverUid = context.auth.uid;
    const receiverRef = usersRef.doc(receiverUid);

    try {
        await admin.firestore().runTransaction(async t => {
            const receiverDoc = await t.get(receiverRef);
            const receiverName = receiverDoc.data().name !== null ? receiverDoc.data().name : '';
            const sender = receiverDoc.data().partnerRequestFrom;
            const senderRef = usersRef.doc(sender.uid);

            // create couple data document in Couples collection
            const coupleDataDoc = couplesRef.doc();
            t.set(coupleDataDoc, {owners: {[receiverUid]: true, [sender.uid]: true}});
            
            // add partner info and add reference to the created couple data doc
            t.update(receiverRef, { partner: { uid: sender.uid, name: sender.name }, coupleDataRef : coupleDataDoc });
            t.update(senderRef, { partner: { uid: receiverUid, name: receiverName }, coupleDataRef : coupleDataDoc });
            
            // delete requests
            t.update(receiverRef, { partnerRequestFrom: FieldValue.delete() });
            t.update(senderRef, { partnerRequestTo: FieldValue.delete() });

        });
    } catch (e) {
        throw new functions.https.HttpsError('internal', ERROR_INTERNAL);
    }
});

exports.rejectPartnerRequest = functions.region('europe-west1').https.onCall(async (data, context) => {

    if (context.auth === null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }

    const receiverUid = context.auth.uid;
    const receiverRef = usersRef.doc(receiverUid);

    try {
        await admin.firestore().runTransaction(async t => {
            const receiverDoc = await t.get(receiverRef);
            const sender = receiverDoc.data().partnerRequestFrom;
            const senderRef = usersRef.doc(sender.uid);

            t.update(receiverRef, { partnerRequestFrom: FieldValue.delete() });
            t.update(senderRef, { partnerRequestTo: FieldValue.delete() });
        });
    } catch (e) {
        throw new functions.https.HttpsError('internal', ERROR_INTERNAL);
    }
});


exports.RemoveAccountPair = functions.region('europe-west1').https.onCall(async (data, context) => {
    if (context.auth === null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }
    const uid = context.auth.uid;
    const userRef = usersRef.doc(uid);
    const coupleRef = userRef.coupleDataRef;

    const userDoc = await userRef.get();

    
    
    try {
        await admin.firestore().runTransaction(async t => {

            if(userRef.partnerRequestTo !== null)
            {
                const partnerRequestTo_uid = userRef.partnerRequestTo.uid;
                const ref_uid = usersRef.doc(partnerRequestTo_uid);
                t.delete(ref_uid.partnerRequestFrom);
            }

            if(userRef.partnerRequestFrom !== null)
            {
                const partnerRequestFrom_uid = userRef.partnerRequestFrom.uid;
                const ref_uid = usersRef.doc(partnerRequestFrom_uid);
                t.delete(ref_uid.partnerRequestTo);
            }

            if(userRef.partner !== null)
            {
                const partner_uid = userRef.partner.uid;
                const partnerRef = usersRef.doc(partner_uid);
                t.delete(partnerRef);
            }

        t.delete(userRef);
        coupleRef.delete;
        });
      }
      catch(error) {
        console.error(error);
        // expected output: ReferenceError: nonExistentFunction is not defined
        // Note - error messages will vary depending on browser
      }
      
});
