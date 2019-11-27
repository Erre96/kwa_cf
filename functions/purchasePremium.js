
exports.createStripeCheckoutSession = async function (data, context, functions, stripe) {

    if (data == null || data.user == null || data.user.name == null ||
        data.user.email == null || data.user.uid == null || data.user.partnerUid == null) {
        throw new functions.https.HttpsError('invalid-argument', 'A user object with uid, name, email and partnerUid is required');
    }

    try {
        const user = data.user;
        const customer = await stripe.customers.create({
            email: user.email,
            name: user.name,
            metadata: {
                app_user_uid: user.uid,
                app_partner_uid: user.partnerUid
            }
        });

        const sku = await stripe.skus.retrieve('sku_GFxUm1mL3PQhUA');

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
            // TODO: change urls when publish
            success_url: 'http://localhost:3000/purchase_success',
            cancel_url: 'http://localhost:3000',
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
        // TODO: if there is no client_reference_id then 
        //get uid from stripe customer object

        //Fullfill the purchase...
        await makeUserPremium(session.client_reference_id, admin);
    }

    response.json({ received: true });
}

async function makeUserPremium(uid, admin) {
    console.log("maker user premium called with uid: " + uid);
    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);

    try {
        await db.runTransaction(async t => {
            const userDoc = await t.get(userRef);
            const user = userDoc.data();
            const partnerUid = user.partner.uid;

            const since = admin.firestore.Timestamp.now();
            const expiryDate = since.toDate();
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
            const expiry = admin.firestore.Timestamp.fromDate(expiryDate);

            const usersPremiumStatusRef = db.collection('users_premium_status');
            t.set(usersPremiumStatusRef.doc(uid), {
                since: since,
                expiry: expiry,
                premium: true
            });

            t.set(usersPremiumStatusRef.doc(partnerUid), {
                since: since,
                expiry: expiry,
                premium: true
            });

        });
    } catch (e) {
        console.log(e);
    }
}