exports.handler = async function (data, context, db) {
    if (data == null || data.userUid == null || data.partnerUid == null) {
        throw new functions.https.HttpsError('invalid-argument', 'userUid and partnerUid is required');
    }

    try {
        const usersPremiumStatusRef = db.collection('users_premium_status');
        await db.runTransaction(async t => {
            // TODO: maybe check if expiry is less than server time here as well?
            t.delete(usersPremiumStatusRef.doc(data.userUid));
            t.delete(usersPremiumStatusRef.doc(data.partnerUid));
        });
    } catch (e) {
        console.log(e);
    }
}