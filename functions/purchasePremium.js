exports.createStripeCheckoutSession = async function (data, context, functions, stripe) {

    if (data == null || data.user == null || data.user.name == null ||
        data.user.email == null || data.user.uid == null) {
        throw new functions.https.HttpsError('invalid-argument', 'A user object with uid, name and email is required');
    }

    try {
        const user = data.user;
        const customer = await stripe.customers.create({
            email: user.email,
            name: user.name,
            metadata: {
                app_user_uid: user.uid,
                app_partner_uid: user.partnerUid ? user.partnerUid : null
            }
        });

        const sku = await stripe.skus.retrieve(functions.config().stripe.sku_id);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                name: sku.attributes.name,
                images: [sku.image],
                amount: sku.price,
                currency: sku.currency,
                quantity: 1,
            }],
            customer: customer.id,
            client_reference_id: user.uid,
            success_url: 'https://app.karlekstanken.se/purchase_success',
            cancel_url: 'https://app.karlekstanken.se',
        });

        return { sessionId: session.id };

    } catch (e) {
        console.log(e);
        throw new functions.https.HttpsError('internal', "ERROR_INTERNAL");
    }
}

exports.onStripeCheckoutCompletedHandler = async function (request, response, stripe, endpointSecret, admin) {
    const sig = request.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(request.rawBody, sig, endpointSecret);
    } catch (e) {
        return response.status(400).send(`Webhook Error: ${e.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log(session);

        //Fullfill the purchase...
        await makeUserPremium(session.client_reference_id, admin);
    }

    response.json({ received: true });
}

async function makeUserPremium(uid, admin) {
    console.log("maker user premium called with uid: " + uid);
    const usersRef = admin.firestore().collection('users');
    const userRef = usersRef.doc(uid);

    try {
        const userDoc = await userRef.get();
        const user = userDoc.data();

        const since = admin.firestore.Timestamp.now();
        const expiry = admin.firestore.Timestamp.now().toDate();
        expiry.setFullYear(expiry.getFullYear() + 1);

        const claims = {
            premium: {
                since: since.toMillis(),
                expiry: expiry.getTime()
            }
        };

        await admin.auth().setCustomUserClaims(uid, claims);
        if (user.partner)
            await admin.auth().setCustomUserClaims(user.partner.uid, claims);

        // Tells client to get updated custom claims and update UI
        await usersRef.doc(uid).update({ shouldRefreshIdToken: true });
        if (user.partner)
            await usersRef.doc(user.partner.uid).update({ shouldRefreshIdToken: true });
    } catch (e) {
        console.error(e);
    }
}