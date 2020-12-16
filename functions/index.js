const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.api_secret);

const sendInvite = require('./sendInvite');
const addPartner = require('./addPartner');
const purchasePremium = require('./purchasePremium')
const revokePremium = require('./revokePremium');
const accountCleanup = require('./accountCleanup');

admin.initializeApp();

const FieldValue = admin.firestore.FieldValue;

const usersRef = admin.firestore().collection('users');

//TODO: use error codes from MyErrorCodes.js
const ERROR_INTERNAL = 'ERROR_INTERNAL';
const ERROR_NOT_AUTHENTICATED = 'ERROR_NOT_AUTHENTICATED';
const ERROR_USER_HAS_NO_PARTNER = 'ERROR_USER_HAS_NO_PARTNER';

exports.sendInvite = functions.region('europe-west1').https.onCall(async (data, context) => {
    return (await sendInvite.handler(data, context, admin, functions));
});

exports.addPartner = functions.region('europe-west1').https.onCall(async (data, context) => {
    return (await addPartner.handler(data, context, admin, FieldValue, functions));
});

exports.removePartner = functions.region('europe-west1').https.onCall(async (data, context) => {

    if (context.auth == null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }

    const userUid = context.auth.uid;
    const userRef = usersRef.doc(userUid);

    try {
        await admin.firestore().runTransaction(async t => {
            const userDoc = await t.get(userRef);
            const partner = userDoc.data().partner;

            if (partner == null) {
                throw new Error(ERROR_USER_HAS_NO_PARTNER);
            }

            const partnerRef = usersRef.doc(partner.uid);
            const coupleDataRef = userDoc.data().coupleDataRef;

            t.update(partnerRef, { partner: FieldValue.delete(), coupleDataRef: FieldValue.delete() });
            t.update(userRef, { partner: FieldValue.delete(), coupleDataRef: FieldValue.delete() });

            if (coupleDataRef) {
                t.delete(coupleDataRef);
            }
        });
    } catch (e) {
        console.log(e);
        if (e instanceof Error) {
            if (e.message === ERROR_USER_HAS_NO_PARTNER) {
                throw new functions.https.HttpsError('not-found', ERROR_USER_HAS_NO_PARTNER);
            }
        }
        throw new functions.https.HttpsError('internal', ERROR_INTERNAL);
    }
});

exports.deleteAccount = functions.region('europe-west1').https.onCall(async (data, context) => {
    if (context.auth == null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }

    const userUid = context.auth.uid;
    const userRef = usersRef.doc(userUid);

    try {
        let partnerUid;
        await admin.firestore().runTransaction(async t => {
            const userDoc = await t.get(userRef);

            // Incase the doc has already been deleted previously by this function then
            // abort without error so that the auth.deleteUser function can run
            if (!userDoc.exists) {
                return;
            }

            const user = userDoc.data();

            if (user.partner) {
                partnerUid = user.partner.uid;
                const partnerRef = usersRef.doc(partnerUid);

                t.delete(partnerRef);
                t.delete(user.coupleDataRef);
            }

            const partnerRequestTo = user.partnerRequestTo;
            if (partnerRequestTo) {
                const receiverRef = usersRef.doc(partnerRequestTo.uid);
                t.update(receiverRef, { partnerRequestFrom: FieldValue.delete() });

            }

            const partnerRequestFrom = user.partnerRequestFrom;
            if (partnerRequestFrom) {
                const senderRef = usersRef.doc(partnerRequestFrom.uid);
                t.update(senderRef, { partnerRequestTo: FieldValue.delete() });
            }

            t.delete(userRef);
        });

        await admin.auth().deleteUser(userUid);
        if (partnerUid) {
            await admin.auth().deleteUser(partnerUid);
        }

    } catch (e) {
        console.log(e);
        throw new functions.https.HttpsError('internal', ERROR_INTERNAL);
    }
});

exports.createStripeCheckoutSession = functions.region('europe-west1').https.onCall(async (data, context) => {
    return (await purchasePremium.createStripeCheckoutSession(data, context, functions, stripe));
});

exports.onStripeCheckoutCompleted = functions.region('europe-west1').https.onRequest((request, response) => {
    purchasePremium.onStripeCheckoutCompletedHandler(request, response, stripe,
        functions.config().stripe.endpoint_secret, admin);
});

exports.revokePremium = functions.region('europe-west1').pubsub.schedule('every day 00:10').timeZone('Europe/Stockholm').onRun(async context => {
    await revokePremium.handler(admin);
});

exports.accountCleanup = functions.region('europe-west1').pubsub.schedule('every day 00:20').timeZone('Europe/Stockholm').onRun(async context => {
    await accountCleanup.handler(admin);
});