const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')(functions.config().stripe.api_secret);
//const cors = require('cors')({origin: true});

admin.initializeApp();

const FieldValue = admin.firestore.FieldValue;

const usersRef = admin.firestore().collection('users');
const couplesRef = admin.firestore().collection('couples');
const usersPremiumStatusRef = admin.firestore().collection('users_premium_status');

//errors
const ERROR_INTERNAL = 'ERROR_INTERNAL';
const ERROR_NOT_AUTHENTICATED = 'ERROR_NOT_AUTHENTICATED';
const ERROR_USER_NOT_FOUND = 'ERROR_USER_NOT_FOUND';
const ERROR_RECEIVER_ALREADY_HAS_PARTNER = 'ERROR_RECEIVER_ALREADY_HAS_PARTNER';
const ERROR_RECEIVER_HAS_PENDING_REQUEST = 'ERROR_RECEIVER_HAS_PENDING_REQUEST';
const ERROR_RECEIVER_EMAIL_REQUIRED = 'ERROR_RECEIVER_EMAIL_REQUIRED';
const ERROR_RECEIVER_EMAIL_IS_SENDERS = 'ERROR_RECEIVER_EMAIL_IS_SENDERS';
const ERROR_USER_HAS_NO_PARTNER = 'ERROR_USER_HAS_NO_PARTNER';

exports.sendPartnerRequest = functions.region('europe-west1').https.onCall(async (data, context) => {

    if (context.auth == null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }

    if (data == null || data.email == null) {
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
    const senderEmail = senderDoc.data().email != null ? senderDoc.data().email : '';
    const senderFirstName = senderDoc.data().firstName != null ? senderDoc.data().firstName : '';
    const senderLastName = senderDoc.data().lastName != null ? senderDoc.data().lastName : '';

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
            const email = doc.data().email != null ? doc.data().email : '';
            const firstName = doc.data().firstName != null ? doc.data().firstName : '';
            const lastName = doc.data().firstName != null ? doc.data().lastName : '';
            const partner = doc.data().partner;
            const partnerRequestFrom = doc.data().partnerRequestFrom;
            const partnerRequestTo = doc.data().partnerRequestTo;

            if (partner != null) {
                throw new Error(ERROR_RECEIVER_ALREADY_HAS_PARTNER);
            } else if (partnerRequestFrom != null || partnerRequestTo != null) {
                throw new Error(ERROR_RECEIVER_HAS_PENDING_REQUEST);
            }

            t.update(receiverRef, { partnerRequestFrom: { uid: senderUid, email: senderEmail, name: senderFirstName + " " + senderLastName } });
            t.update(senderRef, { partnerRequestTo: { uid: uid, email: email, name: firstName + " " + lastName } })
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

    if (context.auth == null) {
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

    if (context.auth == null) {
        throw new functions.https.HttpsError('unauthenticated', ERROR_NOT_AUTHENTICATED);
    }

    const receiverUid = context.auth.uid;
    const receiverRef = usersRef.doc(receiverUid);

    try {
        await admin.firestore().runTransaction(async t => {
            const receiverDoc = await t.get(receiverRef);
            const receiverFirstName = receiverDoc.data().firstName != null ? receiverDoc.data().firstName : '';
            const receiverLastName = receiverDoc.data().lastName != null ? receiverDoc.data().lastName : '';
            const receiverEmail = receiverDoc.data().email != null ? receiverDoc.data().email : '';
            const sender = receiverDoc.data().partnerRequestFrom;
            const senderRef = usersRef.doc(sender.uid);

            // create couple data document in Couples collection
            const coupleDataDoc = couplesRef.doc();
            t.set(coupleDataDoc, { owners: { [receiverUid]: true, [sender.uid]: true } });

            // add partner info and add reference to the created couple data doc
            t.update(receiverRef, { partner: { uid: sender.uid, name: sender.name, email: sender.email }, coupleDataRef: coupleDataDoc });
            t.update(senderRef, { partner: { uid: receiverUid, name: receiverFirstName + " " + receiverLastName, email: receiverEmail }, coupleDataRef: coupleDataDoc });

            // delete requests
            t.update(receiverRef, { partnerRequestFrom: FieldValue.delete() });
            t.update(senderRef, { partnerRequestTo: FieldValue.delete() });

        });
    } catch (e) {
        throw new functions.https.HttpsError('internal', ERROR_INTERNAL);
    }
});

exports.rejectPartnerRequest = functions.region('europe-west1').https.onCall(async (data, context) => {

    if (context.auth == null) {
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
        await admin.firestore().runTransaction(async t => {
            const userDoc = await t.get(userRef);

            // Incase the doc has already been deleted previously by this function then
            // abort without error so that the auth.deleteUser function can run
            if (!userDoc.exists) {
                return;
            }

            const user = userDoc.data();

            if (user.partner) {
                const partnerRef = usersRef.doc(user.partner.uid);

                t.update(partnerRef, {
                    partner: FieldValue.delete(),
                    coupleDataRef: FieldValue.delete(),
                    loveLanguage: FieldValue.delete()
                });

                t.delete(user.coupleDataRef);

                // delete premium status if any
                t.delete(usersPremiumStatusRef.doc(user.partner.uid));
                t.delete(usersPremiumStatusRef.doc(userUid));
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

    } catch (e) {
        console.log(e);
        throw new functions.https.HttpsError('internal', ERROR_INTERNAL);
    }
});

const endpointSecret = functions.config().stripe.endpoint_secret;

exports.onStripeCheckoutCompleted = functions.region('europe-west1').https.onRequest((request, response) => {
    const sig = request.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(request.rawBody, sig, endpointSecret);
    } catch (e) {
        return response.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;

        //Fullfill the purchase...
        console.log(session);
    }

    response.json({ received: true });
});
