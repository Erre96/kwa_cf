const MyErrorCodes = require('./MyErrorCodes');

var admin;
var FieldValue;
var usersRef;
var couplesRef;

exports.handler = async function (data, context, _admin, _FieldValue, functions) {
    admin = _admin;
    FieldValue = _FieldValue;
    usersRef = admin.firestore().collection('users');
    couplesRef = admin.firestore().collection('couples');

    if (context.auth == null) {
        throw new functions.https.HttpsError('unauthenticated', MyErrorCodes.ERROR_NOT_AUTHENTICATED);
    }

    if (data == null || data.email == null) {
        throw new functions.https.HttpsError('invalid-argument', MyErrorCodes.ERROR_RECEIVER_EMAIL_REQUIRED);
    }

    if (data.email === context.auth.token.email) {
        throw new functions.https.HttpsError('invalid-argument', MyErrorCodes.ERROR_RECEIVER_EMAIL_IS_SENDERS);
    }

    const partnerEmail = data.email;
    const userUid = context.auth.uid;

    try {
        const snapshots = await usersRef.where('email', '==', partnerEmail).get();
        if (snapshots.empty) {
            // no matching documents
            throw new Error(MyErrorCodes.ERROR_USER_NOT_FOUND);
        }

        const partnerUid = snapshots.docs[0].id;
        const partnerRef = snapshots.docs[0].ref;
        const userRef = usersRef.doc(userUid);

        await runTransaction(partnerRef, userRef);

        const userPremium = context.auth.token.premium;
        const partnerUserData = await admin.auth().getUser(partnerUid);
        const partnerPremium = partnerUserData.customClaims && partnerUserData.customClaims.premium;

        if (userPremium) {
            // make partner premium
            try {
                await makeUserPremium(partnerUid, userPremium.since, userPremium.expiry);
            } catch (e) {
                // revert db changes
                await revertTransaction(partnerRef, userRef);
                throw new Error(MyErrorCodes.ERROR_INTERNAL);
            }
        } else if (partnerPremium) {
            // make user premium
            try {
                await makeUserPremium(userUid, partnerPremium.since, partnerPremium.expiry);
            } catch (e) {
                // revert db changes
                await revertTransaction(partnerRef, userRef);
                throw new Error(MyErrorCodes.ERROR_INTERNAL);
            }
        }

    } catch (e) {
        console.log(e);
        if (e instanceof Error) {
            if (e.message === MyErrorCodes.ERROR_USER_NOT_FOUND) {
                throw new functions.https.HttpsError('not-found', MyErrorCodes.ERROR_USER_NOT_FOUND);
            } else if (e.message === MyErrorCodes.ERROR_RECEIVER_ALREADY_HAS_PARTNER) {
                throw new functions.https.HttpsError('already-exists', MyErrorCodes.ERROR_RECEIVER_ALREADY_HAS_PARTNER);
            }
        }
        throw new functions.https.HttpsError('internal', MyErrorCodes.ERROR_INTERNAL);
    }
}

function runTransaction(partnerRef, userRef) {
    return admin.firestore().runTransaction(async t => {
        const partnerDoc = await t.get(partnerRef);
        const partnerUid = partnerDoc.id;
        const partnerData = partnerDoc.data();

        const userDoc = await t.get(userRef);
        const userUid = userDoc.id;
        const userData = userDoc.data();

        if (partnerData.partner != null) {
            throw new Error(MyErrorCodes.ERROR_RECEIVER_ALREADY_HAS_PARTNER);
        }

        // create couple data document in Couples collection
        const coupleDataDoc = couplesRef.doc();
        t.set(coupleDataDoc, { owners: { [partnerUid]: true, [userUid]: true } });

        // add partner info and add reference to the created couple data doc
        t.update(partnerRef, {
            partner: {
                uid: userUid,
                name: userData.firstName + " " + userData.lastName,
                email: userData.email
            },
            coupleDataRef: coupleDataDoc
        });
        t.update(userRef, {
            partner: {
                uid: partnerUid,
                name: partnerData.firstName + " " + partnerData.lastName,
                email: partnerData.email
            },
            coupleDataRef: coupleDataDoc
        });
    });
}

function revertTransaction(partnerRef, userRef) {
    return admin.firestore().runTransaction(async t => {
        const userDoc = await t.get(userRef);
        const userData = userDoc.data();

        t.update(partnerRef, {
            partner: FieldValue.delete(),
            coupleDataRef: FieldValue.delete()
        });
        t.update(userRef, {
            partner: FieldValue.delete(),
            coupleDataRef: FieldValue.delete()
        });
        t.delete(userData.coupleDataRef);
    });
}

async function makeUserPremium(uid, since, expiry) {
    const user = await admin.auth().getUser(uid)
    const claims = user.customClaims ? user.customClaims : {};
    claims.premium = {
        since: since,
        expiry: expiry
    };

    await admin.auth().setCustomUserClaims(uid, claims);

    // Tells client to get updated custom claims and update UI
    await usersRef.doc(uid).update({ shouldRefreshIdToken: true });
}